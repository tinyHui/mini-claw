import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	parseCapabilityManifest,
	type ValidationDiagnostic,
} from "./validation.js";

export interface CapabilitySummary {
	name: string;
	description: string;
	path: string;
}

export interface CapabilityScanResult {
	capabilities: CapabilitySummary[];
	diagnostics: ValidationDiagnostic[];
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function scanCapabilities(cronDir: string): Promise<CapabilityScanResult> {
	const capabilitiesDir = join(cronDir, "capabilities");
	const diagnostics: ValidationDiagnostic[] = [];
	const capabilities: CapabilitySummary[] = [];

	if (!(await pathExists(capabilitiesDir))) {
		return { capabilities, diagnostics };
	}

	const entries = await readdir(capabilitiesDir, { withFileTypes: true });
	for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
		const manifestPath = resolve(capabilitiesDir, entry.name, "manifest.yaml");
		const indexPath = resolve(capabilitiesDir, entry.name, "index.mjs");
		if (!(await pathExists(manifestPath))) {
			diagnostics.push({
				level: "error",
				file: manifestPath,
				message: "Capability is missing manifest.yaml.",
			});
			continue;
		}
		if (!(await pathExists(indexPath))) {
			diagnostics.push({
				level: "error",
				file: indexPath,
				message: "Capability is missing index.mjs.",
			});
		}

		const content = await readFile(manifestPath, "utf-8");
		const parsed = parseCapabilityManifest(content, manifestPath);
		diagnostics.push(...parsed.diagnostics);
		if (parsed.manifest) {
			capabilities.push({
				name: parsed.manifest.name,
				description: parsed.manifest.description,
				path: resolve(capabilitiesDir, entry.name),
			});
		}
	}

	return { capabilities, diagnostics };
}
