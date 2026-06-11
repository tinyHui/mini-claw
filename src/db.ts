import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./db/schema.js";
import { logger, withLogContext } from "./logger.js";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

let sqlite: DatabaseType | null = null;
let db: AppDatabase | null = null;

function assertCompatibleSchema(database: DatabaseType): void {
	const table = database
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
		.get();
	if (!table) return;

	const columns = database
		.prepare("PRAGMA table_info(sessions)")
		.all() as { name: string }[];
	const colNames = new Set(columns.map((c) => c.name));
	const oldColumns = [
		"userId",
		"budget_minimal",
		"budget_low",
		"budget_medium",
		"budget_high",
	].filter((name) => colNames.has(name));

	if (oldColumns.length > 0) {
		throw new Error(
			`Existing miniclaw.db uses an unsupported old sessions schema (${oldColumns.join(", ")}). ` +
				"Move or archive miniclaw.db before starting Mini-Claw with the Drizzle schema.",
		);
	}

	const migrationsTable = database
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
		)
		.get();
	if (!migrationsTable) {
		throw new Error(
			"Existing miniclaw.db was not created by Drizzle migrations. " +
				"Move or archive miniclaw.db before starting Mini-Claw with the Drizzle schema.",
		);
	}
}

export function initializeDatabase(workspaceFolder: string): AppDatabase {
	return withLogContext({ operation: "database_init" }, () => {
		const dbPath = join(workspaceFolder, "miniclaw.db");
		const existed = existsSync(dbPath);

		if (existed) {
			logger.info(`Database already exists at ${dbPath}`);
		} else {
			logger.warn(`Database not found at ${dbPath}, creating and initializing`);
			mkdirSync(workspaceFolder, { recursive: true });
		}

		sqlite = new Database(dbPath);
		sqlite.pragma("journal_mode = WAL");
		sqlite.pragma("foreign_keys = ON");
		assertCompatibleSchema(sqlite);
		db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: "drizzle" });

		if (existed) {
			return db;
		}

		logger.info("Database initialized");
		return db;
	});
}

export function getDb(): AppDatabase {
	if (!db) {
		throw new Error("Database not initialized. Call initializeDatabase() first.");
	}
	return db;
}

export function getSqlite(): DatabaseType {
	if (!sqlite) {
		throw new Error("Database not initialized. Call initializeDatabase() first.");
	}
	return sqlite;
}

export function closeDatabase(): void {
	sqlite?.close();
	sqlite = null;
	db = null;
}
