import { parse } from "yaml";

const JOB_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const CAPABILITY_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const CRON_FIELD_RE = /^[A-Za-z0-9*?,/#LW-]+$/;
const DESCRIPTION_RE = /^\s*\/\/\s*description:\s*(\S.*)$/im;

export interface ValidationDiagnostic {
	level: "error" | "warn";
	file?: string;
	message: string;
	type?: string;
}

export interface CapabilityManifest {
	name: string;
	description: string;
	input_schema: unknown;
	output_schema: unknown;
}

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

export function validateCapabilitySlug(slug: string): string[] {
	const errors: string[] = [];
	if (!slug.trim()) {
		errors.push("Capability slug is required.");
		return errors;
	}
	if (!CAPABILITY_SLUG_RE.test(slug)) {
		errors.push(
			"Capability slug must start with a letter or number and contain only letters, numbers, dashes, or underscores.",
		);
	}
	if (slug === "." || slug === ".." || slug.includes("/") || slug.includes("\\")) {
		errors.push("Capability slug must be a single safe path component.");
	}
	return errors;
}

export function validateCronExpression(expression: string): string[] {
	const trimmed = expression.trim();
	if (!trimmed) return ["Cron expression is required."];

	const errors: string[] = [];
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

export function extractJobDescription(content: string): string | undefined {
	const match = DESCRIPTION_RE.exec(content);
	return match?.[1]?.trim();
}

export function parseCapabilityManifest(content: string, file: string): {
	diagnostics: ValidationDiagnostic[];
	manifest?: CapabilityManifest;
} {
	const diagnostics: ValidationDiagnostic[] = [];
	let parsed;
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

	for (const key of ["name", "description", "input_schema", "output_schema"]) {
		if (!(key in parsed)) {
			diagnostics.push({
				level: "error",
				file,
				message: `Capability manifest is missing required field "${key}".`,
			});
		}
	}

	if (typeof parsed.name !== "string" || !parsed.name.trim()) {
		diagnostics.push({
			level: "error",
			file,
			message: 'Capability manifest field "name" must be a non-empty string.',
		});
	}

	if (typeof parsed.description !== "string" || !parsed.description.trim()) {
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
			name: parsed.name,
			description: parsed.description,
			input_schema: parsed.input_schema,
			output_schema: parsed.output_schema,
		},
		diagnostics,
	};
}
