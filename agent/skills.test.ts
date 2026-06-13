import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRepoSkills, mergeRepoSkills } from "./skills.js";

describe("repo skills", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "mini-claw-skills-"));
		await mkdir(join(root, "skills", "research", "demo"), { recursive: true });
		await mkdir(join(root, ".agents", "skills"), { recursive: true });
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("loads nested SKILL.md files from skills and .agents/skills", async () => {
		await writeFile(join(root, "skills", "research", "demo", "SKILL.md"), [
			"---",
			"name: demo-skill",
			"description: Use for demo skill tests.",
			"---",
			"",
			"# Demo",
			"",
		].join("\n"));
		await mkdir(join(root, ".agents", "skills", "agent-demo"), { recursive: true });
		await writeFile(join(root, ".agents", "skills", "agent-demo", "SKILL.md"), [
			"---",
			"name: agent-demo",
			"description: Use for agent demo skill tests.",
			"---",
			"",
			"# Agent Demo",
			"",
		].join("\n"));

		const result = loadRepoSkills(root);

		expect(result.skills.map((skill) => skill.name).sort()).toEqual([
			"agent-demo",
			"demo-skill",
		]);
	});

	it("preserves base skills when merging repo skills", async () => {
		await writeFile(join(root, "skills", "research", "demo", "SKILL.md"), [
			"---",
			"name: demo-skill",
			"description: Use for demo skill tests.",
			"---",
			"",
			"# Demo",
			"",
		].join("\n"));

		const result = mergeRepoSkills({
			skills: [{
				name: "base",
				description: "Base skill",
				filePath: "/base/SKILL.md",
				baseDir: "/base",
				sourceInfo: {
					source: "test",
					path: "/base/SKILL.md",
					scope: "project",
					origin: "top-level",
				},
				disableModelInvocation: false,
			}],
			diagnostics: [],
		}, root);

		expect(result.skills.map((skill) => skill.name).sort()).toEqual(["base", "demo-skill"]);
	});
});
