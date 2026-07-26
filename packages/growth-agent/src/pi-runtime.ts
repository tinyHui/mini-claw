import type { PiTurnRuntime, Profile } from "./types.js";

type Session = {
  prompt(text: string): Promise<void>;
  subscribe?(listener: (event: unknown) => void): (() => void) | void;
  abort?(): void;
  dispose?(): Promise<void> | void;
  messages?: Array<{ role?: string; content?: unknown }>;
};

export class PiSdkRuntime implements PiTurnRuntime {
  private sessions = new Set<Session>();

  constructor(private readonly workspace: string) {}

  async run(profile: Profile, prompt: string, signal?: AbortSignal): Promise<string> {
    const packageName = "@earendil-works/pi-coding-agent";
    const sdk = await import(packageName) as Record<string, unknown>;
    const create = sdk.createAgentSession;
    if (typeof create !== "function") throw new Error("Pinned Pi SDK does not export createAgentSession");
    const tools = profile === "coding" ? ["read", "bash", "edit", "write"] : [];
    const created = await (create as (options: Record<string, unknown>) => Promise<unknown>)({
      cwd: this.workspace,
      noTools: "all",
      tools
    });
    const session = (created as { session?: Session }).session ?? created as Session;
    this.sessions.add(session);
    const abort = (): void => session.abort?.();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await session.prompt(prompt);
      const assistant = [...(session.messages ?? [])].reverse().find((message) => message.role === "assistant");
      if (typeof assistant?.content === "string") return assistant.content;
      if (Array.isArray(assistant?.content)) {
        return assistant.content
          .filter((block): block is { type: "text"; text: string } =>
            Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "text" &&
            typeof (block as { text?: unknown }).text === "string")
          .map((block) => block.text)
          .join("\n");
      }
      return "";
    } finally {
      signal?.removeEventListener("abort", abort);
      await session.dispose?.();
      this.sessions.delete(session);
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions].map(async (session) => { session.abort?.(); await session.dispose?.(); }));
    this.sessions.clear();
  }
}
