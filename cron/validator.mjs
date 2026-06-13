#!/usr/bin/env node
import { resolve } from "node:path";
import { writeCronRegistry } from "./registry.mjs";
import { validateCronRuntime } from "./scanner.mjs";

function parseArgs(argv) {
	const args = {
		cronDir: "cron",
		json: false,
		writeDb: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--cron-dir") {
			args.cronDir = argv[i + 1];
			i += 1;
		} else if (arg === "--json") {
			args.json = true;
		} else if (arg === "--write-db") {
			args.writeDb = true;
		} else if (arg === "--help" || arg === "-h") {
			args.help = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!args.cronDir) throw new Error("--cron-dir requires a value");
	return args;
}

function printHuman(result) {
	console.log(`Cron validation ${result.ok ? "passed" : "failed"}`);
	console.log(`Jobs: ${result.counts.jobs}`);
	console.log(`Capabilities: ${result.counts.capabilities}`);
	for (const diagnostic of [...result.errors, ...result.warnings]) {
		console.log(`${diagnostic.level.toUpperCase()}: ${diagnostic.file ? `${diagnostic.file}: ` : ""}${diagnostic.message}`);
	}
	if (result.registry) {
		console.log(`Registry written: ${result.registry.jobsWritten} jobs, ${result.registry.capabilitiesWritten} capabilities`);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log("Usage: node cron/validator.mjs --cron-dir <cronDir> [--json] [--write-db]");
		return 0;
	}

	const result = await validateCronRuntime(resolve(args.cronDir));
	if (args.writeDb && result.ok) {
		result.registry = writeCronRegistry(result);
	}

	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		printHuman(result);
	}

	return result.ok ? 0 : 1;
}

try {
	process.exitCode = await main();
} catch (error) {
	const diagnostic = {
		ok: false,
		counts: { jobs: 0, capabilities: 0, errors: 1, warnings: 0 },
		successes: [],
		warnings: [],
		errors: [{
			level: "error",
			message: error instanceof Error ? error.message : String(error),
		}],
		jobs: [],
		capabilities: [],
	};
	if (process.argv.includes("--json")) {
		console.log(JSON.stringify(diagnostic, null, 2));
	} else {
		console.error(diagnostic.errors[0].message);
	}
	process.exitCode = 1;
}
