import { SandboxManager } from "@carderne/sandbox-runtime";
import { logger } from "../../logger.js";
import { buildGlobalSandboxConfig } from "./sandbox-config.js";

let initialized = false;

export function isSandboxReady(): boolean {
	return initialized;
}

/**
 * Initialize the global SandboxManager once at process startup.
 * Sets up network proxies and a restrictive base filesystem policy.
 * Per-session overrides are applied via wrapWithSandbox(customConfig).
 */
export async function ensureSandboxInitialized(): Promise<boolean> {
	if (initialized) return true;

	const platform = process.platform;
	if (platform !== "darwin" && platform !== "linux") {
		logger.info("Sandbox not supported on this platform, skipping", {
			platform,
		});
		return false;
	}

	try {
		const config = buildGlobalSandboxConfig();
		await SandboxManager.initialize(config);
		initialized = true;
		logger.info("Sandbox initialized", {
			allowedDomains: config.network.allowedDomains.length,
		});
		return true;
	} catch (err) {
		logger.error("Sandbox initialization failed", {
			error: err instanceof Error ? err.message : String(err),
		});
		return false;
	}
}

export async function resetSandbox(): Promise<void> {
	if (!initialized) return;
	try {
		await SandboxManager.reset();
		initialized = false;
		logger.debug("Sandbox reset");
	} catch {
		// Ignore cleanup errors during shutdown
	}
}
