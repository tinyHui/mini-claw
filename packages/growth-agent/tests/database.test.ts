import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppDatabase } from "../src/database.js";

describe("AppDatabase", () => {
  it("migrates a clean database and persists gateway offsets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-claw-db-"));
    const store = await AppDatabase.open(join(dir, "state.db"));
    expect(await store.integrityCheck()).toBe("ok");
    expect(await store.getOffset("telegram")).toBeNull();
    await store.setOffset("telegram", "42");
    expect(await store.getOffset("telegram")).toBe("42");
    store.close();
  });
});
