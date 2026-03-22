import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { logger, withLogContext } from "./logger.js";

let db: DatabaseType | null = null;

const CURRENT_SCHEMA = `
	CREATE TABLE IF NOT EXISTS sessions (
		id              TEXT    NOT NULL PRIMARY KEY,
		userId          TEXT    NOT NULL,
		createdAt       TEXT    NOT NULL,
		model           TEXT    NOT NULL,
		thinkingLevel   TEXT    NOT NULL,
		budget_minimal  INTEGER NOT NULL DEFAULT 0,
		budget_low      INTEGER NOT NULL DEFAULT 0,
		budget_medium   INTEGER NOT NULL DEFAULT 0,
		budget_high     INTEGER NOT NULL DEFAULT 0
	);

	CREATE INDEX IF NOT EXISTS idx_sessions_user
		ON sessions (userId, createdAt DESC);

	CREATE TABLE IF NOT EXISTS messages (
		id          TEXT    NOT NULL,
		sessionId   TEXT    NOT NULL,
		timeStamp   TEXT    NOT NULL,
		role        TEXT    NOT NULL,
		content     TEXT    NOT NULL,
		status      TEXT    NOT NULL DEFAULT 'pending',
		PRIMARY KEY (id, sessionId),
		FOREIGN KEY (sessionId) REFERENCES sessions(id)
	);
`;

function migrateIfNeeded(database: DatabaseType): void {
	const columns = database
		.prepare("PRAGMA table_info(sessions)")
		.all() as { name: string }[];
	const colNames = new Set(columns.map((c) => c.name));

	if (!colNames.has("userId")) {
		logger.info("Migrating sessions table: adding userId and createdAt");
		database.exec(`
			ALTER TABLE sessions ADD COLUMN userId TEXT NOT NULL DEFAULT '';
			ALTER TABLE sessions ADD COLUMN createdAt TEXT NOT NULL DEFAULT '';
			UPDATE sessions SET userId = id, createdAt = datetime('now') WHERE userId = '';
			CREATE INDEX IF NOT EXISTS idx_sessions_user
				ON sessions (userId, createdAt DESC);
		`);
	}
}

export function initializeDatabase(workspaceFolder: string): DatabaseType {
	return withLogContext({ operation: "database_init" }, () => {
		const dbPath = join(workspaceFolder, "miniclaw.db");

		if (existsSync(dbPath)) {
			logger.info(`Database already exists at ${dbPath}`);
			db = new Database(dbPath);
			db.pragma("journal_mode = WAL");
			db.pragma("foreign_keys = ON");
			migrateIfNeeded(db);
			return db;
		}

		logger.warn(`Database not found at ${dbPath}, creating and initializing`);

		mkdirSync(workspaceFolder, { recursive: true });

		db = new Database(dbPath);
		db.pragma("journal_mode = WAL");
		db.pragma("foreign_keys = ON");
		db.exec(CURRENT_SCHEMA);

		logger.info("Database initialized");
		return db;
	});
}

export function getDb(): DatabaseType {
	if (!db) {
		throw new Error("Database not initialized. Call initializeDatabase() first.");
	}
	return db;
}
