import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./db/schema.js";

export function createMigratedDatabase(dbPath: string): void {
	const sqlite = new Database(dbPath);
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: "drizzle" });
	sqlite.close();
}
