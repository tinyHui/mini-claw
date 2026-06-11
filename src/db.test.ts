import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { closeDatabase, initializeDatabase } from "./db.js";

describe("db", () => {
	let dir: string | undefined;

	afterEach(async () => {
		closeDatabase();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("runs Drizzle migrations for a fresh database", async () => {
		dir = await mkdtemp(join(tmpdir(), "mini-claw-db-"));

		initializeDatabase(dir);

		const sqlite = new Database(join(dir, "miniclaw.db"));
		const tables = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all() as { name: string }[];
		sqlite.close();
		expect(tables.map((table) => table.name)).toEqual(
			expect.arrayContaining(["__drizzle_migrations", "sessions", "messages"]),
		);
	});

	it("rejects old user-scoped session databases", async () => {
		dir = await mkdtemp(join(tmpdir(), "mini-claw-db-"));
		const sqlite = new Database(join(dir, "miniclaw.db"));
		sqlite.exec(`
			CREATE TABLE sessions (
				id TEXT NOT NULL PRIMARY KEY,
				userId TEXT NOT NULL,
				createdAt TEXT NOT NULL,
				model TEXT NOT NULL,
				thinkingLevel TEXT NOT NULL,
				budget_low INTEGER NOT NULL DEFAULT 0
			);
		`);
		sqlite.close();

		expect(() => initializeDatabase(dir!)).toThrow("unsupported old sessions schema");
	});
});
