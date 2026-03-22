import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const JSONL_EXT = ".jsonl";

/**
 * First 8 characters of the session id (UUID segment or hex without hyphens).
 */
export function sessionIdShort(sessionId: string): string {
	return sessionId.replace(/-/g, "").slice(0, 8);
}

/**
 * Local timestamp for filenames: `YYYY-MM-DDTHH:MM:SS` (no ms / timezone suffix).
 */
export function formatSessionFileTimestamp(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	const h = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	const s = String(d.getSeconds()).padStart(2, "0");
	return `${y}-${m}-${day}T${h}:${min}:${s}`;
}

function escapeForRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * New history filename: `YYYY-MM-DDTHH:MM:SS_<user_id>_<session_id_8chars>.jsonl`
 */
export function buildNewSessionHistoryFilename(
	userId: string,
	sessionId: string,
	now: Date = new Date(),
): string {
	const ts = formatSessionFileTimestamp(now);
	const short = sessionIdShort(sessionId);
	return `${ts}_${userId}_${short}${JSONL_EXT}`;
}

function matchesSessionHistoryPattern(
	name: string,
	userId: string,
	sessionShort: string,
): boolean {
	const re = new RegExp(
		`^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}_${escapeForRegex(userId)}_${escapeForRegex(sessionShort)}\\.jsonl$`,
	);
	return re.test(name);
}

/**
 * Resolve the path to the chat history file for this user/session.
 * Reuses an existing file in sessionDir if one matches the pattern; otherwise
 * returns a new path with the current timestamp.
 */
export async function resolveSessionHistoryPath(
	sessionDir: string,
	userId: string,
	sessionId: string,
	now: Date = new Date(),
): Promise<string> {
	const short = sessionIdShort(sessionId);
	let names: string[];
	try {
		names = await readdir(sessionDir);
	} catch {
		return join(sessionDir, buildNewSessionHistoryFilename(userId, sessionId, now));
	}

	const matching = names.filter((n) =>
		matchesSessionHistoryPattern(n, userId, short),
	);
	if (matching.length === 0) {
		return join(sessionDir, buildNewSessionHistoryFilename(userId, sessionId, now));
	}

	const withMtime = await Promise.all(
		matching.map(async (name) => {
			const full = join(sessionDir, name);
			const s = await stat(full);
			return { full, mtimeMs: s.mtimeMs };
		}),
	);
	withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return withMtime[0]!.full;
}
