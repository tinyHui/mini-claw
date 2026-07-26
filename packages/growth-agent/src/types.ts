import { z } from "zod";

export const ProfileSchema = z.enum(["research", "coding", "publisher", "system"]);
export type Profile = z.infer<typeof ProfileSchema>;

export const PlatformSchema = z.enum(["reddit", "x", "rednote"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const ConnectorModeSchema = z.enum(["disabled", "draft", "publish"]);
export type ConnectorMode = z.infer<typeof ConnectorModeSchema>;

export const SourceItemSchema = z.object({
  source: z.string().min(1),
  externalId: z.string().min(1),
  url: z.url(),
  title: z.string().min(1),
  observedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().optional(),
  score: z.number().optional(),
  summary: z.string().optional(),
  metadata: z.record(z.string(), z.unknown())
});
export type SourceItem = z.infer<typeof SourceItemSchema>;

export const SourceStatusSchema = z.object({
  source: z.string().min(1),
  ok: z.boolean(),
  checkedAt: z.iso.datetime(),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional()
});
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SourceResultSchema = z.object({
  items: z.array(SourceItemSchema),
  status: SourceStatusSchema,
  nextCursor: z.string().optional()
});
export type SourceResult = z.infer<typeof SourceResultSchema>;

export interface ResearchSource {
  readonly name: string;
  fetch(window: { from: Date; to: Date }, cursor?: string): Promise<SourceResult>;
}

export const DraftInputSchema = z.object({
  platform: PlatformSchema,
  account: z.string().min(1),
  target: z.string().min(1).optional(),
  body: z.string().min(1),
  media: z.array(z.string()),
  replyParent: z.string().min(1).optional(),
  policyVersion: z.string().min(1)
});
export type DraftInput = z.infer<typeof DraftInputSchema>;

export const StoredDraftSchema = DraftInputSchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["draft", "awaiting_approval", "approved", "published", "rejected", "failed"]),
  createdAt: z.iso.datetime()
});
export type StoredDraft = z.infer<typeof StoredDraftSchema>;

export const PolicyResultSchema = z.object({
  decision: z.enum(["allow", "warn", "deny"]),
  reasons: z.array(z.string()),
  policyVersion: z.string()
});
export type PolicyResult = z.infer<typeof PolicyResultSchema>;

export const PublicationReceiptSchema = z.object({
  platformId: z.string().min(1),
  url: z.url(),
  publishedAt: z.iso.datetime(),
  rawReference: z.string().optional()
});
export type PublicationReceipt = z.infer<typeof PublicationReceiptSchema>;

export interface Publisher {
  readonly platform: Platform;
  preview(draft: StoredDraft): Promise<PolicyResult>;
  lookup(idempotencyKey: string): Promise<PublicationReceipt | null>;
  publish(draft: StoredDraft, approvalId: string): Promise<PublicationReceipt>;
}

export interface PiTurnRuntime {
  run(profile: Profile, prompt: string, signal?: AbortSignal): Promise<string>;
  close(): Promise<void>;
}
