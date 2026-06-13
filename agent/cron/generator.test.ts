import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateCronArtifacts } from "./generator.js";

describe("generateCronArtifacts", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "mini-claw-generate-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("runs Codex inside cronDir and validates generated files", async () => {
		let workingDirectory: string | undefined;
		let prompt = "";
		let validatorInput: { appRoot: string; cronDir: string } | undefined;
		const codex = {
			startThread(options: { workingDirectory?: string }) {
				workingDirectory = options.workingDirectory;
				return {
					async run(input: string) {
						prompt = input;
						if (!workingDirectory) throw new Error("missing workingDirectory");
						await mkdir(join(workingDirectory, "jobs"), { recursive: true });
						await writeFile(
							join(workingDirectory, "jobs", "digest.mjs"),
							"// description: Daily digest job\nconsole.log('digest');\n",
						);
						await writeFile(join(workingDirectory, "jobs", "digest.cron"), "0 8 * * *\n");
						return {
							finalResponse: JSON.stringify({
								summary: "Created digest job.",
								files: ["jobs/digest.mjs", "jobs/digest.cron"],
							}),
							items: [
								{
									id: "change-1",
									type: "file_change" as const,
									status: "completed" as const,
									changes: [
										{ path: "jobs/digest.mjs", kind: "add" as const },
										{ path: "jobs/digest.cron", kind: "add" as const },
									],
								},
							],
						};
					},
				};
			},
		};

		const result = await generateCronArtifacts(
			{ request: "daily digest", cronDir: root, appRoot: root },
			{
				codex,
				readCronContext: () => ({
					jobs: [{ name: "existing", description: "Existing job", cronExpression: "0 7 * * *" }],
					capabilities: [{
						slug: "001-existing",
						name: "existing",
						description: "Existing capability",
						inputSchemaJson: "{}",
						outputSchemaJson: "{}",
					}],
				}),
				runValidator: async (input) => {
					validatorInput = input;
					return {
						exitCode: 0,
						stdout: JSON.stringify({
							ok: true,
							counts: { errors: 0, warnings: 0 },
							errors: [],
							warnings: [],
						}),
						stderr: "",
					};
				},
				restartCronProcess: async () => ({
					ok: true,
					processName: "mini-claw-cron",
					command: "pm2 restart mini-claw-cron",
					stdout: "",
					stderr: "",
				}),
			},
		);

		expect(workingDirectory).toBe(root);
		expect(prompt).toContain("existing: Existing job (0 7 * * *)");
		expect(prompt).toContain("001-existing (existing): Existing capability");
		expect(prompt).toContain("// description: <human-readable purpose>");
		expect(validatorInput).toEqual({ appRoot: root, cronDir: root });
		expect(result.summary).toBe("Created digest job.");
		expect(result.files).toEqual(["jobs/digest.cron", "jobs/digest.mjs"]);
		expect(result.diagnostics).toEqual([]);
		expect(result.pm2Restart?.ok).toBe(true);
	});

	it("reports Codex file changes outside cronDir", async () => {
		const codex = {
			startThread() {
				return {
					async run() {
						return {
							finalResponse: JSON.stringify({
								summary: "Attempted unsafe write.",
								files: ["../outside.txt"],
							}),
							items: [
								{
									id: "change-1",
									type: "file_change" as const,
									status: "completed" as const,
									changes: [{ path: "../outside.txt", kind: "add" as const }],
								},
							],
						};
					},
				};
			},
		};

		const result = await generateCronArtifacts(
			{ request: "unsafe", cronDir: root, appRoot: root },
			{
				codex,
				readCronContext: () => ({ jobs: [], capabilities: [] }),
				runValidator: async () => ({
					exitCode: 0,
					stdout: JSON.stringify({
						ok: true,
						counts: { errors: 0, warnings: 0 },
						errors: [],
						warnings: [],
					}),
					stderr: "",
				}),
			},
		);

		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				level: "error",
				message: expect.stringContaining("outside cronDir"),
			}),
		]);
	});

	it("warns when pm2 restart fails after valid generation", async () => {
		const codex = {
			startThread(options: { workingDirectory?: string }) {
				return {
					async run() {
						if (!options.workingDirectory) throw new Error("missing workingDirectory");
						await mkdir(join(options.workingDirectory, "jobs"), { recursive: true });
						await writeFile(
							join(options.workingDirectory, "jobs", "digest.mjs"),
							"// description: Daily digest job\nconsole.log('digest');\n",
						);
						await writeFile(join(options.workingDirectory, "jobs", "digest.cron"), "0 8 * * *\n");
						return {
							finalResponse: JSON.stringify({
								summary: "Created digest job.",
								files: ["jobs/digest.mjs", "jobs/digest.cron"],
							}),
							items: [],
						};
					},
				};
			},
		};

		const result = await generateCronArtifacts(
			{ request: "daily digest", cronDir: root, appRoot: root },
			{
				codex,
				readCronContext: () => ({ jobs: [], capabilities: [] }),
				runValidator: async () => ({
					exitCode: 0,
					stdout: JSON.stringify({
						ok: true,
						counts: { errors: 0, warnings: 0 },
						errors: [],
						warnings: [],
					}),
					stderr: "",
				}),
				restartCronProcess: async () => ({
					ok: false,
					processName: "mini-claw-cron",
					command: "pm2 restart mini-claw-cron",
					stdout: "",
					stderr: "process not found",
					error: "process not found",
				}),
			},
		);

		expect(result.pm2Restart?.ok).toBe(false);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				level: "warn",
				message: expect.stringContaining("pm2 could not restart mini-claw-cron"),
			}),
		]);
	});

	it("does not restart pm2 when cron validator reports errors", async () => {
		let restarted = false;
		const codex = {
			startThread(options: { workingDirectory?: string }) {
				return {
					async run() {
						if (!options.workingDirectory) throw new Error("missing workingDirectory");
						await mkdir(join(options.workingDirectory, "jobs"), { recursive: true });
						await writeFile(join(options.workingDirectory, "jobs", "bad.mjs"), "console.log('bad');\n");
						return {
							finalResponse: JSON.stringify({
								summary: "Created invalid job.",
								files: ["jobs/bad.mjs"],
							}),
							items: [],
						};
					},
				};
			},
		};

		const result = await generateCronArtifacts(
			{ request: "bad job", cronDir: root, appRoot: root },
			{
				codex,
				readCronContext: () => ({ jobs: [], capabilities: [] }),
				runValidator: async () => ({
					exitCode: 1,
					stdout: JSON.stringify({
						ok: false,
						counts: { errors: 1, warnings: 0 },
						errors: [{ level: "error", message: "Missing schedule file bad.cron." }],
						warnings: [],
					}),
					stderr: "",
				}),
				restartCronProcess: async () => {
					restarted = true;
					return {
						ok: true,
						processName: "mini-claw-cron",
						command: "pm2 restart mini-claw-cron",
						stdout: "",
						stderr: "",
					};
				},
			},
		);

		expect(restarted).toBe(false);
		expect(result.pm2Restart).toBeUndefined();
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				level: "error",
				message: expect.stringContaining("Missing schedule file"),
			}),
		]);
	});
});
