import { join, resolve } from "node:path";
import {
	loadSkillsFromDir,
	type ResourceDiagnostic,
	type Skill,
} from "@mariozechner/pi-coding-agent";

const SKILL_DIR_EXCLUDES = new Set([
	".git",
	".github",
	".archive",
	"dist",
	"node_modules",
]);

export interface RepoSkillsResult {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
}

function loadSkillDir(path: string, source: string): RepoSkillsResult {
	try {
		return loadSkillsFromDir({ dir: path, source });
	} catch (error) {
		return {
			skills: [],
			diagnostics: [
				{
					type: "error",
					message: `Failed to load skills from ${path}: ${error instanceof Error ? error.message : String(error)}`,
					path,
				},
			],
		};
	}
}

function isAllowedSkillPath(path: string): boolean {
	const parts = resolve(path).split(/[\\/]/);
	return !parts.some((part) => SKILL_DIR_EXCLUDES.has(part));
}

export function loadRepoSkills(appRoot: string): RepoSkillsResult {
	const roots = [
		{ path: join(appRoot, "skills"), source: "mini-claw-skills" },
		{ path: join(appRoot, ".agents", "skills"), source: "mini-claw-agent-skills" },
	].filter((root) => isAllowedSkillPath(root.path));

	const merged: RepoSkillsResult = { skills: [], diagnostics: [] };
	const seen = new Set<string>();
	for (const root of roots) {
		const result = loadSkillDir(root.path, root.source);
		for (const skill of result.skills) {
			const key = `${skill.name}:${skill.filePath}`;
			if (seen.has(key)) continue;
			seen.add(key);
			merged.skills.push(skill);
		}
		merged.diagnostics.push(...result.diagnostics);
	}
	return merged;
}

export function mergeRepoSkills(
	base: RepoSkillsResult,
	appRoot: string,
): RepoSkillsResult {
	const repo = loadRepoSkills(appRoot);
	const seen = new Set(base.skills.map((skill) => `${skill.name}:${skill.filePath}`));
	const skills = [...base.skills];
	for (const skill of repo.skills) {
		const key = `${skill.name}:${skill.filePath}`;
		if (seen.has(key)) continue;
		seen.add(key);
		skills.push(skill);
	}
	return {
		skills,
		diagnostics: [...base.diagnostics, ...repo.diagnostics],
	};
}
