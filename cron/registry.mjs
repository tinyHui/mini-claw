import { join } from "node:path";
import Database from "better-sqlite3";

export function getDefaultDatabasePath() {
	return join(process.cwd(), "miniclaw.db");
}

function deleteMissing(sqlite, table, key, values) {
	if (values.length === 0) {
		sqlite.prepare(`DELETE FROM ${table}`).run();
		return;
	}
	const placeholders = values.map(() => "?").join(", ");
	sqlite.prepare(`DELETE FROM ${table} WHERE ${key} NOT IN (${placeholders})`).run(...values);
}

export function writeCronRegistry(validation, dbPath = getDefaultDatabasePath()) {
	const sqlite = new Database(dbPath, { fileMustExist: true });
	try {
		const write = sqlite.transaction(() => {
			const upsertJob = sqlite.prepare(`
				INSERT INTO cron_jobs (
					name, description, cronExpression, enabled, hasSeconds, scriptPath, schedulePath, contentHash, validatedAt
				) VALUES (
					@name, @description, @cronExpression, @enabled, @hasSeconds, @scriptPath, @schedulePath, @contentHash, @validatedAt
				)
				ON CONFLICT(name) DO UPDATE SET
					description = excluded.description,
					cronExpression = excluded.cronExpression,
					hasSeconds = excluded.hasSeconds,
					scriptPath = excluded.scriptPath,
					schedulePath = excluded.schedulePath,
					contentHash = excluded.contentHash,
					validatedAt = excluded.validatedAt
			`);
			const upsertCapability = sqlite.prepare(`
				INSERT INTO cron_capabilities (
					slug, name, description, manifestPath, entrypointPath, inputSchemaJson, outputSchemaJson, contentHash, validatedAt
				) VALUES (
					@slug, @name, @description, @manifestPath, @entrypointPath, @inputSchemaJson, @outputSchemaJson, @contentHash, @validatedAt
				)
				ON CONFLICT(slug) DO UPDATE SET
					name = excluded.name,
					description = excluded.description,
					manifestPath = excluded.manifestPath,
					entrypointPath = excluded.entrypointPath,
					inputSchemaJson = excluded.inputSchemaJson,
					outputSchemaJson = excluded.outputSchemaJson,
					contentHash = excluded.contentHash,
					validatedAt = excluded.validatedAt
			`);

			for (const row of validation.jobs) upsertJob.run({ ...row, enabled: 1 });
			for (const row of validation.capabilities) upsertCapability.run(row);
			deleteMissing(sqlite, "cron_jobs", "name", validation.jobs.map((row) => row.name));
			deleteMissing(sqlite, "cron_capabilities", "slug", validation.capabilities.map((row) => row.slug));
		});

		write();
		return {
			dbPath,
			jobsWritten: validation.jobs.length,
			capabilitiesWritten: validation.capabilities.length,
		};
	} finally {
		sqlite.close();
	}
}
