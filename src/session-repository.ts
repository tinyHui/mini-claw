import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { sessions, type SessionRow } from "./db/schema.js";

export type Session = SessionRow;

export type CreateSessionData = {
	model: string;
	thinkingLevel: string;
};

let lastCreatedAtMs = 0;

function nextCreatedAt(): string {
	const now = Date.now();
	lastCreatedAtMs = Math.max(now, lastCreatedAtMs + 1);
	return new Date(lastCreatedAtMs).toISOString();
}

export function createSession(data: CreateSessionData): Session {
	const db = getDb();
	const session: Session = {
		id: randomUUID(),
		createdAt: nextCreatedAt(),
		model: data.model,
		thinkingLevel: data.thinkingLevel,
	};

	db.insert(sessions).values(session).run();

	return session;
}

export function getSession(sessionId: string): Session | undefined {
	const db = getDb();
	return db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
}

export function getLatestSession(): Session | undefined {
	const db = getDb();
	return db
		.select()
		.from(sessions)
		.orderBy(desc(sessions.createdAt))
		.limit(1)
		.get();
}

export function ensureSession(): Session {
	const existing = getLatestSession();
	if (existing) return existing;
	return createSession({ model: "default", thinkingLevel: "low" });
}

export function resetSession(): Session {
	return createSession({
		model: "default",
		thinkingLevel: "low",
	});
}
