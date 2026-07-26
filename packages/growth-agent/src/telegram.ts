import { createReadStream } from "node:fs";
import type { AppDatabase } from "./database.js";
import { log } from "./logger.js";
import type { Platform } from "./types.js";

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { id: number };
    text?: string;
    reply_to_message?: { text?: string; caption?: string };
  };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { chat: { id: number } } };
}

interface TelegramResponse<T> { ok: boolean; result: T; description?: string }

export interface TelegramHandlers {
  health(): Promise<string>;
  brief(): Promise<{ text: string; path: string }>;
  jobs(): Promise<string>;
  watch(value: string): Promise<string>;
  draft(platform: Platform, body: string): Promise<{ text: string; token: string }>;
  edit(draftId: string, body: string): Promise<{ text: string; token: string }>;
  decide(token: string, decision: "approved" | "rejected", actor: string): Promise<string>;
  stop(): Promise<string>;
}

export class TelegramGateway {
  private stopped = false;
  private controller: AbortController | undefined;

  constructor(
    private readonly token: string,
    private readonly ownerId: number,
    private readonly store: AppDatabase,
    private readonly handlers: TelegramHandlers
  ) {}

  start(): void { void this.poll(); }
  stop(): void { this.stopped = true; this.controller?.abort(); }

  async send(chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
    await this.call("sendMessage", {
      chat_id: chatId,
      text: text.slice(0, 4000),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    });
  }

  async sendDocument(chatId: number, path: string, caption: string): Promise<void> {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("caption", caption);
    form.set("document", new Blob([await BunlessFile.read(path)]), path.split("/").at(-1) ?? "report.md");
    await this.call("sendDocument", form);
  }

  private async poll(): Promise<void> {
    let offset = Number(await this.store.getOffset("telegram") ?? 0);
    while (!this.stopped) {
      this.controller = new AbortController();
      try {
        const response = await this.call<TelegramUpdate[]>("getUpdates", {
          offset, timeout: 30, allowed_updates: ["message", "callback_query"]
        }, this.controller.signal);
        for (const update of response) {
          offset = update.update_id + 1;
          await this.handle(update);
          await this.store.setOffset("telegram", String(offset));
        }
      } catch (error) {
        if (!this.stopped) {
          log("warn", "telegram polling failed", { error: error instanceof Error ? error.message : String(error) });
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
    }
  }

  private async handle(update: TelegramUpdate): Promise<void> {
    const userId = update.message?.from?.id ?? update.callback_query?.from.id;
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (userId !== this.ownerId) {
      await this.store.audit("telegram_denied", userId ? String(userId) : null, null, { updateId: update.update_id });
      return;
    }
    if (!chatId) return;
    const text = update.message?.text?.trim() ?? "";
    try {
      if (update.callback_query?.data) {
        const separator = update.callback_query.data.indexOf(":");
        const action = update.callback_query.data.slice(0, separator);
        const token = update.callback_query.data.slice(separator + 1);
        if ((action === "approve" || action === "reject") && token) {
          const result = await this.handlers.decide(token, action === "approve" ? "approved" : "rejected", String(userId));
          await this.call("answerCallbackQuery", { callback_query_id: update.callback_query.id, text: result.slice(0, 180) });
          await this.send(chatId, result);
        }
        return;
      }
      if (text === "/start" || text === "/health") await this.send(chatId, await this.handlers.health());
      else if (text === "/brief now") {
        await this.send(chatId, "Brief queued.");
        const report = await this.handlers.brief();
        await this.sendDocument(chatId, report.path, report.text);
      } else if (text === "/jobs") await this.send(chatId, await this.handlers.jobs());
      else if (text.startsWith("/watch ")) await this.send(chatId, await this.handlers.watch(text.slice(7).trim()));
      else if (text.startsWith("/draft ")) {
        const platform = text.slice(7).trim() as Platform;
        if (!["reddit", "x", "rednote"].includes(platform)) throw new Error("platform must be reddit, x, or rednote");
        const body = update.message?.reply_to_message?.text ?? update.message?.reply_to_message?.caption ?? "";
        if (!body) throw new Error("reply to a report item or message when using /draft");
        const draft = await this.handlers.draft(platform, body);
        await this.send(chatId, draft.text, {
          inline_keyboard: [[
            { text: "Approve", callback_data: `approve:${draft.token}` },
            { text: "Reject", callback_data: `reject:${draft.token}` }
          ]]
        });
      }
      else if (text.startsWith("/edit ")) {
        const draftId = text.slice(6).trim();
        const body = update.message?.reply_to_message?.text ?? update.message?.reply_to_message?.caption ?? "";
        if (!draftId || !body) throw new Error("reply to replacement text with /edit <draft-id>");
        const draft = await this.handlers.edit(draftId, body);
        await this.send(chatId, draft.text, {
          inline_keyboard: [[
            { text: "Approve", callback_data: `approve:${draft.token}` },
            { text: "Reject", callback_data: `reject:${draft.token}` }
          ]]
        });
      }
      else if (text === "/stop") await this.send(chatId, await this.handlers.stop());
      else if (text) await this.send(chatId, "Supported: /health, /brief now, /watch <topic>, /draft <platform>, /edit <draft-id>, /jobs, /stop");
    } catch (error) {
      await this.send(chatId, `Request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async call<T>(method: string, body: Record<string, unknown> | FormData, signal?: AbortSignal): Promise<T> {
    const init: RequestInit = {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body)
    };
    if (!(body instanceof FormData)) init.headers = { "content-type": "application/json" };
    if (signal) init.signal = signal;
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, init);
    const payload = await response.json() as TelegramResponse<T>;
    if (!response.ok || !payload.ok) throw new Error(payload.description ?? `Telegram returned ${response.status}`);
    return payload.result;
  }
}

class BunlessFile {
  static async read(path: string): Promise<Uint8Array> {
    const chunks: Buffer[] = [];
    for await (const chunk of createReadStream(path)) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
}
