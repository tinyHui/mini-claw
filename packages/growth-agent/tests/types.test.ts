import { describe, expect, it } from "vitest";
import { DraftInputSchema, SourceItemSchema } from "../src/types.js";

describe("application schemas", () => {
  it("accepts a valid typed draft", () => {
    expect(DraftInputSchema.parse({
      platform: "reddit",
      account: "owner",
      body: "A useful post",
      media: [],
      policyVersion: "v1"
    }).platform).toBe("reddit");
  });

  it("rejects malformed evidence URLs", () => {
    expect(() => SourceItemSchema.parse({
      source: "test",
      externalId: "1",
      url: "not-a-url",
      title: "Evidence",
      observedAt: new Date().toISOString(),
      metadata: {}
    })).toThrow();
  });
});
