import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

export interface Session {
	id: string;
	model: string;
	thinkingLevel: string;
	budget_minimal: number;
	budget_low: number;
	budget_medium: number;
	budget_high: number;
}

export type CreateSessionData = Partial<Omit<Session, "id">> &
	Pick<Session, "model" | "thinkingLevel"> & { id?: string };

export function createSession(data: CreateSessionData): Session {
	const db = getDb();
	const session: Session = {
		id: data.id ?? randomUUID(),
		model: data.model,
		thinkingLevel: data.thinkingLevel,
		budget_minimal: data.budget_minimal ?? 0,
		budget_low: data.budget_low ?? 0,
		budget_medium: data.budget_medium ?? 0,
		budget_high: data.budget_high ?? 0,
	};

	db.prepare(`
		INSERT INTO sessions (id, model, thinkingLevel, budget_minimal, budget_low, budget_medium, budget_high)
		VALUES (@id, @model, @thinkingLevel, @budget_minimal, @budget_low, @budget_medium, @budget_high)
	`).run(session);

	return session;
}

export function getSession(sessionId: string): Session | undefined {
	const db = getDb();
	return db
		.prepare("SELECT * FROM sessions WHERE id = ?")
		.get(sessionId) as Session | undefined;
}

// Creates a default session for sessionId if one does not already exist.
export function ensureSession(sessionId: string): Session {
	const existing = getSession(sessionId);
	if (existing) return existing;
	return createSession({ id: sessionId, model: "default", thinkingLevel: "low" });
}

// Replaces the session row with fresh defaults, effectively starting a new
// conversation context while keeping historical messages in the DB.
export function resetSession(sessionId: string): Session {
	const db = getDb();
	const session: Session = {
		id: sessionId,
		model: "default",
		thinkingLevel: "low",
		budget_minimal: 128,
		budget_low: 512,
		budget_medium: 1024,
		budget_high: 2048,
	};
	db.prepare(`
		INSERT OR REPLACE INTO sessions (id, model, thinkingLevel, budget_minimal, budget_low, budget_medium, budget_high)
		VALUES (@id, @model, @thinkingLevel, @budget_minimal, @budget_low, @budget_medium, @budget_high)
	`).run(session);
	return session;
}
