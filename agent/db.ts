import { existsSync } from "node:fs";
import { join } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema.js";
import { logger, withLogContext } from "./logger.js";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

let sqlite: DatabaseType | null = null;
let db: AppDatabase | null = null;

export function getDefaultDatabasePath(): string {
	return join(process.cwd(), "miniclaw.db");
}

function assertCompatibleSchema(database: DatabaseType): void {
	const table = database
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
		.get();
	if (!table) {
		throw new Error(
			"Database is missing required table 'sessions'. " +
				"Run 'pnpm db:migrate' from the project root before starting Mini-Claw.",
		);
	}

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
				"Run 'pnpm db:migrate' from the project root before starting Mini-Claw.",
		);
	}
}

export function initializeDatabase(dbPath = getDefaultDatabasePath()): AppDatabase {
	return withLogContext({ operation: "database_init" }, () => {
		if (!existsSync(dbPath)) {
			throw new Error(
				`Database file not found at ${dbPath}. ` +
					"Run 'pnpm db:migrate' from the project root before starting Mini-Claw.",
			);
		}

		logger.info(`Opening database at ${dbPath}`);
		try {
			sqlite = new Database(dbPath);
			sqlite.pragma("journal_mode = WAL");
			sqlite.pragma("foreign_keys = ON");
			assertCompatibleSchema(sqlite);
			db = drizzle(sqlite, { schema });
			return db;
		} catch (error) {
			sqlite?.close();
			sqlite = null;
			db = null;
			throw error;
		}
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
