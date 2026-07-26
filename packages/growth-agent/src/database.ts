import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import { auditEvents, databaseSchema, gatewayOffsets, sourceItems } from "./schema.js";
import { SourceItemSchema, type SourceItem } from "./types.js";

export class AppDatabase {
  readonly sqlite: DatabaseSync;
  readonly orm: SqliteRemoteDatabase<typeof databaseSchema>;

  private constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    this.orm = drizzle(async (query, params, method) => {
      // This adapter is the single low-level boundary between Drizzle and
      // Node's dependency-free SQLite driver. Application services never
      // prepare SQL themselves.
      const statement = this.sqlite.prepare(query);
      if (method === "run") {
        const result = statement.run(...params);
        return { rows: [{ changes: result.changes, lastInsertRowid: result.lastInsertRowid }] };
      }
      if (method === "values") {
        statement.setReturnArrays(true);
        return { rows: statement.all(...params) as unknown[][] };
      }
      if (method === "get") return { rows: statement.get(...params) as never };
      return { rows: statement.all(...params) };
    }, { schema: databaseSchema });
  }

  static async open(path: string, migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))): Promise<AppDatabase> {
    const store = new AppDatabase(path);
    try {
      await migrate(store.orm, async (queries) => {
        store.sqlite.exec("BEGIN EXCLUSIVE");
        try {
          for (const query of queries) store.sqlite.exec(query);
          store.sqlite.exec("COMMIT");
        } catch (error) {
          store.sqlite.exec("ROLLBACK");
          throw error;
        }
      }, { migrationsFolder });
      return store;
    } catch (error) {
      store.close();
      throw error;
    }
  }

  close(): void { this.sqlite.close(); }

  async integrityCheck(): Promise<string> {
    const result = await this.orm.get<{ quick_check: string }>(sql`PRAGMA quick_check`);
    return result?.quick_check ?? "unknown";
  }

  async saveSourceItem(rawItem: SourceItem, hash: string): Promise<void> {
    const item = SourceItemSchema.parse(rawItem);
    await this.orm.insert(sourceItems).values({
      id: randomUUID(),
      source: item.source,
      externalId: item.externalId,
      url: item.url,
      title: item.title,
      observedAt: item.observedAt,
      publishedAt: item.publishedAt ?? null,
      hash,
      metadata: item.metadata
    }).onConflictDoUpdate({
      target: [sourceItems.source, sourceItems.externalId],
      set: {
        url: item.url,
        title: item.title,
        observedAt: item.observedAt,
        publishedAt: item.publishedAt ?? null,
        hash,
        metadata: item.metadata
      }
    });
  }

  async getOffset(gateway: string): Promise<string | null> {
    const [row] = await this.orm.select({ offset: gatewayOffsets.offset })
      .from(gatewayOffsets).where(eq(gatewayOffsets.gateway, gateway)).limit(1);
    return row?.offset ?? null;
  }

  async setOffset(gateway: string, offset: string): Promise<void> {
    const updatedAt = new Date().toISOString();
    await this.orm.insert(gatewayOffsets).values({ gateway, offset, updatedAt }).onConflictDoUpdate({
      target: gatewayOffsets.gateway,
      set: { offset, updatedAt }
    });
  }

  async audit(kind: string, actor: string | null, subjectId: string | null, details: Record<string, unknown>): Promise<void> {
    await this.orm.insert(auditEvents).values({
      id: randomUUID(), kind, actor, subjectId, details, createdAt: new Date().toISOString()
    });
  }
}
