import { defineTool, type ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { Config } from "../../config.js";
import { generateCronArtifacts } from "../../cron/generator.js";

export interface CronGeneratorExtensionOptions {
	config: Config;
}

function formatGeneratedFiles(files: string[]): string {
	if (files.length === 0) return "No file changes were reported.";
	return files.map((file) => `- cron/${file}`).join("\n");
}

export function createCronGeneratorExtensionFactory(
	options: CronGeneratorExtensionOptions,
): ExtensionFactory {
	return (pi) => {
		pi.registerTool(defineTool({
			name: "generate_cron_artifacts",
			label: "Generate Cron Artifacts",
			description:
				"Generate or update Mini-Claw cron jobs and capabilities from a natural-language request. Use only for cron job creation or cron capability authoring.",
			promptSnippet:
				"generate_cron_artifacts: create or update files under cron/jobs and cron/capabilities for scheduled tasks",
			promptGuidelines: [
				"When the user asks to schedule recurring autonomous work, use the cron-job-authoring skill and this tool.",
				"Do not invent Telegram slash commands for cron management.",
				"Keep generated cron output log-only unless the user explicitly asks for a capability that delivers elsewhere.",
			],
			parameters: Type.Object({
				request: Type.String({
					description: "The user's cron job or cron capability request, with any clarified schedule and behavior.",
				}),
			}),
			async execute(_toolCallId, params) {
				const result = await generateCronArtifacts({
					request: params.request,
					cronDir: options.config.cronDir,
					appRoot: options.config.appRoot,
				});
				const errors = result.diagnostics.filter((diagnostic) => diagnostic.level === "error");
				const warnings = result.diagnostics.filter((diagnostic) => diagnostic.level === "warn");
				const text = [
					result.summary,
					"",
					"Files:",
					formatGeneratedFiles(result.files),
					result.pm2Restart?.ok ? `\npm2 restarted ${result.pm2Restart.processName}.` : "",
					errors.length > 0 ? `\nErrors:\n${errors.map((diagnostic) => `- ${diagnostic.message}`).join("\n")}` : "",
					warnings.length > 0 ? `\nWarnings:\n${warnings.map((diagnostic) => `- ${diagnostic.message}`).join("\n")}` : "",
				].filter(Boolean).join("\n");

				return {
					content: [{ type: "text", text }],
					details: result,
				};
			},
		}));
	};
}
