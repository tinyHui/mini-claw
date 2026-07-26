import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApprovalService, draftHash } from "../src/approvals.js";
import { AppDatabase } from "../src/database.js";
import type { DraftInput } from "../src/types.js";

const input: DraftInput = {
  platform: "reddit",
  account: "owner",
  target: "test",
  body: "Useful post",
  media: [],
  policyVersion: "v1"
};

describe("ApprovalService", () => {
  it("hashes canonical content deterministically", () => {
    expect(draftHash(input)).toBe(draftHash({ ...input }));
    expect(draftHash(input)).not.toBe(draftHash({ ...input, body: "Changed" }));
  });

  it("uses a one-time approval token", async () => {
    const store = await AppDatabase.open(join(mkdtempSync(join(tmpdir(), "mini-claw-approval-")), "state.db"));
    const approvals = new ApprovalService(store, 15);
    const draft = await approvals.createDraft(input);
    const request = await approvals.request(draft.id);
    expect((await approvals.decide(request.token, "123", "approved")).status).toBe("approved");
    await expect(approvals.decide(request.token, "123", "approved")).rejects.toThrow(/already used/);
    store.close();
  });

  it("revokes an approval when a draft is revised", async () => {
    const store = await AppDatabase.open(join(mkdtempSync(join(tmpdir(), "mini-claw-revise-")), "state.db"));
    const approvals = new ApprovalService(store, 15);
    const original = await approvals.createDraft(input);
    const request = await approvals.request(original.id);
    const revised = await approvals.revise(original.id, { ...input, body: "Revised" });
    expect(revised.version).toBe(2);
    await expect(approvals.decide(request.token, "123", "approved")).rejects.toThrow(/already used/);
    store.close();
  });
});
