import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, initializeDatabase } from "./db.js";
import {
	createSession,
	ensureSession,
	getLatestSession,
	getSession,
	resetSession,
} from "./session-repository.js";

describe("session-repository", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "mini-claw-db-"));
		initializeDatabase(dir);
	});

	afterEach(async () => {
		closeDatabase();
		await rm(dir, { recursive: true, force: true });
	});

	it("creates sessions without user or budget fields", () => {
		const session = createSession({ model: "default", thinkingLevel: "low" });

		expect(session.id).toBeTruthy();
		expect(session.model).toBe("default");
		expect(session.thinkingLevel).toBe("low");
		expect(getSession(session.id)).toEqual(session);
		expect(session).not.toHaveProperty("userId");
		expect(session).not.toHaveProperty("budget_low");
	});

	it("ensures the latest existing session", () => {
		const first = ensureSession();
		const second = ensureSession();

		expect(second).toEqual(first);
		expect(getLatestSession()).toEqual(first);
	});

	it("resets by creating a new default session", () => {
		const first = ensureSession();
		const second = resetSession();

		expect(second.id).not.toBe(first.id);
		expect(second.model).toBe("default");
		expect(second.thinkingLevel).toBe("low");
		expect(getLatestSession()?.id).toBe(second.id);
	});
});
