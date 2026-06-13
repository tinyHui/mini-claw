import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./agent/db/schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
	dbCredentials: {
		url: "./miniclaw.db",
	},
});
