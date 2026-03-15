import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

export interface Session {
	id: string;
	userId: string;
	createdAt: string;
	model: string;
	thinkingLevel: string;
	budget_minimal: number;
	budget_low: number;
	budget_medium: number;
	budget_high: number;
}

export type CreateSessionData = {
	userId: string;
	model: string;
	thinkingLevel: string;
	budget_minimal?: number;
	budget_low?: number;
	budget_medium?: number;
	budget_high?: number;
};

export function createSession(data: CreateSessionData): Session {
	const db = getDb();
	const session: Session = {
		id: randomUUID(),
		userId: data.userId,
		createdAt: new Date().toISOString(),
		model: data.model,
		thinkingLevel: data.thinkingLevel,
		budget_minimal: data.budget_minimal ?? 0,
		budget_low: data.budget_low ?? 0,
		budget_medium: data.budget_medium ?? 0,
		budget_high: data.budget_high ?? 0,
	};

	db.prepare(`
		INSERT INTO sessions (id, userId, createdAt, model, thinkingLevel, budget_minimal, budget_low, budget_medium, budget_high)
		VALUES (@id, @userId, @createdAt, @model, @thinkingLevel, @budget_minimal, @budget_low, @budget_medium, @budget_high)
	`).run(session);

	return session;
}

export function getSession(sessionId: string): Session | undefined {
	const db = getDb();
	return db
		.prepare("SELECT * FROM sessions WHERE id = ?")
		.get(sessionId) as Session | undefined;
}

export function getLatestSessionForUser(userId: string): Session | undefined {
	const db = getDb();
	return db
		.prepare("SELECT * FROM sessions WHERE userId = ? ORDER BY createdAt DESC LIMIT 1")
		.get(userId) as Session | undefined;
}

export function ensureSession(userId: string): Session {
	const existing = getLatestSessionForUser(userId);
	if (existing) return existing;
	return createSession({ userId, model: "default", thinkingLevel: "low" });
}

export function resetSession(userId: string): Session {
	return createSession({
		userId,
		model: "default",
		thinkingLevel: "low",
		budget_minimal: 128,
		budget_low: 512,
		budget_medium: 1024,
		budget_high: 2048,
	});
}
