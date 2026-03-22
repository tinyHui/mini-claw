import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildNewSessionHistoryFilename,
	formatSessionFileTimestamp,
	resolveSessionHistoryPath,
	sessionIdShort,
} from "./session-history-path.js";

describe("session-history-path", () => {
	describe("sessionIdShort", () => {
		it("returns first 8 hex chars without hyphens", () => {
			expect(sessionIdShort("bf84f08c-8a5e-41ff-881d-8d5591c1581b")).toBe("bf84f08c");
		});
	});

	describe("formatSessionFileTimestamp", () => {
		it("formats as YYYY-MM-DDTHH:MM:SS in local time", () => {
			const d = new Date(2026, 2, 22, 21, 29, 6);
			const s = formatSessionFileTimestamp(d);
			expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
			expect(s).toBe("2026-03-22T21:29:06");
		});
	});

	describe("buildNewSessionHistoryFilename", () => {
		it("builds YYYY-MM-DDTHH:MM:SS_<user>_<8>.jsonl", () => {
			const d = new Date(2026, 2, 22, 21, 29, 6);
			const name = buildNewSessionHistoryFilename(
				"12345",
				"bf84f08c-8a5e-41ff-881d-8d5591c1581b",
				d,
			);
			expect(name).toBe(`${formatSessionFileTimestamp(d)}_12345_bf84f08c.jsonl`);
		});
	});

	describe("resolveSessionHistoryPath", () => {
		let dir: string;

		it("returns a new timestamped path when directory is empty", async () => {
			dir = join(tmpdir(), `mc-sess-${Date.now()}`);
			await mkdir(dir, { recursive: true });
			const fixed = new Date(2026, 2, 22, 10, 0, 0);
			const p = await resolveSessionHistoryPath(
				dir,
				"999",
				"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
				fixed,
			);
			expect(p).toBe(
				join(
					dir,
					`${formatSessionFileTimestamp(fixed)}_999_aaaaaaaa.jsonl`,
				),
			);
		});

		it("reuses existing file matching user and session short id", async () => {
			dir = join(tmpdir(), `mc-sess-${Date.now()}-2`);
			await mkdir(dir, { recursive: true });
			const existing = join(dir, "2026-03-21T08:00:00_111_abcdef12.jsonl");
			await writeFile(existing, `${JSON.stringify({ type: "session" })}\n`, "utf8");

			const p = await resolveSessionHistoryPath(
				dir,
				"111",
				"abcdef12-0000-0000-0000-000000000000",
				new Date(),
			);
			expect(p).toBe(existing);
		});

		it("picks most recently modified when multiple matches exist", async () => {
			dir = join(tmpdir(), `mc-sess-${Date.now()}-3`);
			await mkdir(dir, { recursive: true });
			const older = join(dir, "2026-03-20T08:00:00_222_deadbeef.jsonl");
			const newer = join(dir, "2026-03-22T08:00:00_222_deadbeef.jsonl");
			const stubLine = `${JSON.stringify({ type: "session" })}\n`;
			await writeFile(older, stubLine, "utf8");
			await writeFile(newer, stubLine, "utf8");

			const p = await resolveSessionHistoryPath(
				dir,
				"222",
				"deadbeef-0000-0000-0000-000000000000",
				new Date(),
			);
			expect(p).toBe(newer);
		});
	});
});
