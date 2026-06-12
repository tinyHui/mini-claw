import { parse } from "yaml";

export interface ValidationDiagnostic {
	level: "error" | "warn";
	message: string;
	file?: string;
}

export interface CapabilityManifest {
	name: string;
	description: string;
	input_schema: unknown;
	output_schema: unknown;
}

const JOB_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const CRON_FIELD_RE = /^[A-Za-z0-9*?,/#LW-]+$/;

export function validateJobName(name: string): string[] {
	const errors: string[] = [];
	if (!name.trim()) {
		errors.push("Job name is required.");
		return errors;
	}
	if (!JOB_NAME_RE.test(name)) {
		errors.push(
			"Job name must start with a letter or number and contain only letters, numbers, dashes, or underscores.",
		);
	}
	if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
		errors.push("Job name must be a single safe path component.");
	}
	return errors;
}

export function validateCronExpression(expression: string): string[] {
	const trimmed = expression.trim();
	const errors: string[] = [];
	if (!trimmed) {
		return ["Cron expression is required."];
	}

	const fields = trimmed.split(/\s+/);
	if (fields.length !== 5 && fields.length !== 6) {
		errors.push("Cron expression must have 5 fields, or 6 fields when seconds are used.");
	}

	for (const field of fields) {
		if (!CRON_FIELD_RE.test(field)) {
			errors.push(`Invalid cron field "${field}".`);
		}
	}

	return errors;
}

export function hasCronSeconds(expression: string): boolean {
	return expression.trim().split(/\s+/).length === 6;
}

export function parseCapabilityManifest(
	content: string,
	file?: string,
): { manifest?: CapabilityManifest; diagnostics: ValidationDiagnostic[] } {
	const diagnostics: ValidationDiagnostic[] = [];
	let parsed: unknown;
	try {
		parsed = parse(content);
	} catch (error) {
		diagnostics.push({
			level: "error",
			file,
			message: `Capability manifest is invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
		});
		return { diagnostics };
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		diagnostics.push({
			level: "error",
			file,
			message: "Capability manifest must be a YAML mapping.",
		});
		return { diagnostics };
	}

	const record = parsed as Record<string, unknown>;
	for (const key of ["name", "description", "input_schema", "output_schema"]) {
		if (!(key in record)) {
			diagnostics.push({
				level: "error",
				file,
				message: `Capability manifest is missing required field "${key}".`,
			});
		}
	}

	if (typeof record.name !== "string" || !record.name.trim()) {
		diagnostics.push({
			level: "error",
			file,
			message: 'Capability manifest field "name" must be a non-empty string.',
		});
	}

	if (typeof record.description !== "string" || !record.description.trim()) {
		diagnostics.push({
			level: "error",
			file,
			message: 'Capability manifest field "description" must be a non-empty string.',
		});
	}

	if (diagnostics.some((diagnostic) => diagnostic.level === "error")) {
		return { diagnostics };
	}

	return {
		manifest: {
			name: record.name as string,
			description: record.description as string,
			input_schema: record.input_schema,
			output_schema: record.output_schema,
		},
		diagnostics,
	};
}
