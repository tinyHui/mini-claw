import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "./database.js";
import { approvals, drafts } from "./schema.js";
import { DraftInputSchema, StoredDraftSchema, type DraftInput, type StoredDraft } from "./types.js";

export function draftHash(rawInput: DraftInput): string {
  const input = DraftInputSchema.parse(rawInput);
  const canonical = JSON.stringify({
    platform: input.platform,
    account: input.account,
    target: input.target ?? null,
    body: input.body.replace(/\r\n/g, "\n"),
    media: [...input.media],
    replyParent: input.replyParent ?? null,
    policyVersion: input.policyVersion
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export class ApprovalService {
  constructor(private readonly store: AppDatabase, private readonly expiryMinutes: number) {}

  async createDraft(rawInput: DraftInput, version = 1): Promise<StoredDraft> {
    const input = DraftInputSchema.parse(rawInput);
    const now = new Date().toISOString();
    const draft = StoredDraftSchema.parse({
      ...input, id: randomUUID(), version, contentHash: draftHash(input), status: "draft", createdAt: now
    });
    await this.store.orm.insert(drafts).values({
      id: draft.id,
      version,
      platform: draft.platform,
      account: draft.account,
      target: draft.target ?? null,
      body: draft.body,
      media: draft.media,
      replyParent: draft.replyParent ?? null,
      policyVersion: draft.policyVersion,
      contentHash: draft.contentHash,
      status: draft.status,
      createdAt: now,
      updatedAt: now
    });
    return draft;
  }

  async revise(draftId: string, input: DraftInput): Promise<StoredDraft> {
    const previous = await this.getDraft(draftId);
    const now = new Date().toISOString();
    await this.store.orm.transaction(async (tx) => {
      await tx.update(approvals).set({ decision: "revoked", decidedAt: now })
        .where(and(eq(approvals.draftId, draftId), isNull(approvals.decision)));
      await tx.update(drafts).set({ status: "rejected", updatedAt: now }).where(eq(drafts.id, draftId));
    });
    return this.createDraft(input, previous.version + 1);
  }

  async request(draftId: string): Promise<{ approvalId: string; token: string; expiresAt: string }> {
    const draft = await this.getDraft(draftId);
    if (draft.status !== "draft") throw new Error("draft is not requestable");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const approvalId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.expiryMinutes * 60_000).toISOString();
    await this.store.orm.transaction(async (tx) => {
      await tx.insert(approvals).values({
        id: approvalId,
        draftId,
        tokenHash,
        contentHash: draft.contentHash,
        expiresAt,
        createdAt: now.toISOString()
      });
      await tx.update(drafts).set({ status: "awaiting_approval", updatedAt: now.toISOString() })
        .where(eq(drafts.id, draftId));
    });
    return { approvalId, token, expiresAt };
  }

  async decide(token: string, actor: string, decision: "approved" | "rejected"): Promise<StoredDraft> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const [row] = await this.store.orm.select({
      approvalId: approvals.id,
      draftId: approvals.draftId,
      approvalHash: approvals.contentHash,
      expiresAt: approvals.expiresAt,
      decision: approvals.decision,
      draftHash: drafts.contentHash,
      status: drafts.status
    }).from(approvals).innerJoin(drafts, eq(drafts.id, approvals.draftId))
      .where(eq(approvals.tokenHash, tokenHash)).limit(1);
    if (!row || row.decision) throw new Error("approval token is invalid or already used");
    if (row.status !== "awaiting_approval" || row.approvalHash !== row.draftHash) {
      throw new Error("draft changed after approval request");
    }
    if (Date.parse(row.expiresAt) <= Date.now()) throw new Error("approval token expired");
    const now = new Date().toISOString();
    await this.store.orm.transaction(async (tx) => {
      await tx.update(approvals).set({ decision, actor, decidedAt: now })
        .where(and(eq(approvals.id, row.approvalId), isNull(approvals.decision)));
      await tx.update(drafts).set({ status: decision, updatedAt: now }).where(eq(drafts.id, row.draftId));
    });
    return this.getDraft(row.draftId);
  }

  async getDraft(id: string): Promise<StoredDraft> {
    const [row] = await this.store.orm.select().from(drafts).where(eq(drafts.id, id)).limit(1);
    if (!row) throw new Error("draft not found");
    return StoredDraftSchema.parse({
      id: row.id,
      version: row.version,
      platform: row.platform,
      account: row.account,
      ...(row.target ? { target: row.target } : {}),
      body: row.body,
      media: row.media,
      ...(row.replyParent ? { replyParent: row.replyParent } : {}),
      policyVersion: row.policyVersion,
      contentHash: row.contentHash,
      status: row.status,
      createdAt: row.createdAt
    });
  }
}
