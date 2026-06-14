import { join, resolve } from "node:path";

export const GENERATED_CRON_DIR = "generated/cron";
export const APP_CRON_JOBS_DIR = "cron/jobs";
export const CRON_JOBS_DIR = "jobs";
export const CRON_CAPABILITIES_DIR = "capabilities";
export const CRON_OUTPUT_DIR = "output";

export function getDefaultGeneratedCronDir(appRoot = process.cwd()): string {
	return resolve(appRoot, GENERATED_CRON_DIR);
}

export function getDefaultAppCronJobsDir(appRoot = process.cwd()): string {
	return resolve(appRoot, APP_CRON_JOBS_DIR);
}

export function getCronJobsDir(cronDir: string): string {
	return join(cronDir, CRON_JOBS_DIR);
}

export function getCronCapabilitiesDir(cronDir: string): string {
	return join(cronDir, CRON_CAPABILITIES_DIR);
}

export function getCronOutputDir(cronDir: string): string {
	return join(cronDir, CRON_OUTPUT_DIR);
}

export function getJobScriptFileName(name: string): string {
	return `${name}.mjs`;
}

export function getJobScheduleFileName(name: string): string {
	return `${name}.cron`;
}

export function getJobScriptPath(cronDir: string, name: string): string {
	return join(getCronJobsDir(cronDir), getJobScriptFileName(name));
}

export function getJobSchedulePath(cronDir: string, name: string): string {
	return join(getCronJobsDir(cronDir), getJobScheduleFileName(name));
}

export function getAppJobSourceFileName(name: string): string {
	return `${name}.ts`;
}

export function getAppJobRuntimeFileName(name: string): string {
	return `${name}.js`;
}

export function getAppJobScheduleFileName(name: string): string {
	return `${name}.cron`;
}

export function getCapabilityManifestFileName(): string {
	return "manifest.yaml";
}

export function getCapabilityEntrypointFileName(): string {
	return "index.mjs";
}

export function getCapabilityManifestPath(cronDir: string, slug: string): string {
	return join(getCronCapabilitiesDir(cronDir), slug, getCapabilityManifestFileName());
}

export function getCapabilityEntrypointPath(cronDir: string, slug: string): string {
	return join(getCronCapabilitiesDir(cronDir), slug, getCapabilityEntrypointFileName());
}
