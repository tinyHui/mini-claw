import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./database.js";
import type { ApprovalService } from "./approvals.js";
import type { Platform, PublicationReceipt, Publisher } from "./types.js";
import { and, count, eq, gte } from "drizzle-orm";
import { approvals as approvalsTable, drafts, publications } from "./schema.js";

export class PublicationService {
  constructor(
    private readonly store: AppDatabase,
    private readonly approvals: ApprovalService,
    private readonly config: AppConfig,
    private readonly publishers: Map<Platform, Publisher>
  ) {}

  async publish(draftId: string, approvalId: string): Promise<PublicationReceipt> {
    const draft = await this.approvals.getDraft(draftId);
    if (draft.status !== "approved") throw new Error("draft is not approved");
    if (this.config.connectors[draft.platform] !== "publish") throw new Error(`${draft.platform} is in draft-only mode`);
    if (this.config.connectors.dryRunUntil && Date.parse(this.config.connectors.dryRunUntil) > Date.now()) {
      throw new Error("all connectors are still in the seven-day dry-run period");
    }
    const [approval] = await this.store.orm.select({
      id: approvalsTable.id,
      contentHash: approvalsTable.contentHash
    }).from(approvalsTable).where(and(
      eq(approvalsTable.id, approvalId),
      eq(approvalsTable.draftId, draftId),
      eq(approvalsTable.decision, "approved")
    )).limit(1);
    if (!approval || approval.contentHash !== draft.contentHash) throw new Error("approval does not match the current draft");
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const [daily] = await this.store.orm.select({ value: count() }).from(publications).where(and(
      eq(publications.platform, draft.platform),
      eq(publications.result, "published"),
      gte(publications.createdAt, since.toISOString())
    ));
    if ((daily?.value ?? 0) >= this.config.limits.dailyWritesPerPlatform) throw new Error("daily platform write limit reached");
    const publisher = this.publishers.get(draft.platform);
    if (!publisher) throw new Error(`no enabled publisher for ${draft.platform}`);
    const existing = await publisher.lookup(draft.contentHash);
    if (existing) return existing;
    const publicationId = randomUUID();
    const now = new Date().toISOString();
    await this.store.orm.insert(publications).values({
      id: publicationId,
      draftId: draft.id,
      approvalId,
      platform: draft.platform,
      requestHash: draft.contentHash,
      result: "publishing",
      createdAt: now,
      updatedAt: now
    });
    try {
      const receipt = await publisher.publish(draft, approvalId);
      await this.store.orm.update(publications).set({
        platformId: receipt.platformId,
        url: receipt.url,
        result: "published",
        rawReference: receipt.rawReference ?? null,
        updatedAt: new Date().toISOString()
      }).where(eq(publications.id, publicationId));
      await this.store.orm.update(drafts).set({
        status: "published", updatedAt: new Date().toISOString()
      }).where(eq(drafts.id, draft.id));
      return receipt;
    } catch (error) {
      await this.store.orm.update(publications).set({
        result: "failed", updatedAt: new Date().toISOString()
      }).where(eq(publications.id, publicationId));
      await this.store.orm.update(drafts).set({
        status: "failed", updatedAt: new Date().toISOString()
      }).where(eq(drafts.id, draft.id));
      throw error;
    }
  }
}

export class DraftOnlyPublisher implements Publisher {
  constructor(readonly platform: Platform) {}
  async preview(): Promise<{ decision: "warn"; reasons: string[]; policyVersion: string }> {
    return { decision: "warn", reasons: [`${this.platform} publishing is draft-only`], policyVersion: "v1" };
  }
  async lookup(): Promise<null> { return null; }
  async publish(): Promise<never> { throw new Error(`${this.platform} publishing is disabled`); }
}
