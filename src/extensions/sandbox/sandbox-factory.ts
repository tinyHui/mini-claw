import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
	SandboxManager,
	type SandboxRuntimeConfig,
} from "@carderne/sandbox-runtime";
import {
	type BashOperations,
	createBashTool,
	isToolCallEventType,
	type ExtensionFactory,
} from "@mariozechner/pi-coding-agent";
import { logger } from "../../logger.js";
import { buildSessionSandboxConfig } from "./sandbox-config.js";

function createSandboxedBashOps(
	sessionConfig: Partial<SandboxRuntimeConfig>,
): BashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout, env }) {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}`);
			}

			const wrappedCommand = await SandboxManager.wrapWithSandbox(
				command,
				undefined,
				sessionConfig as SandboxRuntimeConfig,
			);

			return new Promise((promiseResolve, reject) => {
				const child = spawn("bash", ["-c", wrappedCommand], {
					cwd,
					env,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});

				let timedOut = false;
				let timeoutHandle: NodeJS.Timeout | undefined;

				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) {
							try {
								process.kill(-child.pid, "SIGKILL");
							} catch {
								child.kill("SIGKILL");
							}
						}
					}, timeout * 1000);
				}

				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);

				child.on("error", (err) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					reject(err);
				});

				const onAbort = () => {
					if (child.pid) {
						try {
							process.kill(-child.pid, "SIGKILL");
						} catch {
							child.kill("SIGKILL");
						}
					}
				};

				signal?.addEventListener("abort", onAbort, { once: true });

				child.on("close", (code) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					signal?.removeEventListener("abort", onAbort);

					if (signal?.aborted) {
						reject(new Error("aborted"));
					} else if (timedOut) {
						reject(new Error(`timeout:${timeout}`));
					} else {
						promiseResolve({ exitCode: code });
					}
				});
			});
		},
	};
}

function matchesAllowedPath(
	filePath: string,
	allowedPaths: string[],
): boolean {
	const expanded = filePath.replace(/^~/, homedir());
	const abs = resolve(expanded);
	return allowedPaths.some((pattern) => {
		const expandedP = pattern.replace(/^~/, homedir());
		const absP = resolve(expandedP);
		return abs === absP || abs.startsWith(absP + "/");
	});
}

/**
 * Creates an ExtensionFactory that sandboxes bash commands and enforces
 * path policies on read/write/edit tools for a specific session workspace.
 *
 * Bash commands: wrapped with OS-level sandbox via SandboxManager.wrapWithSandbox
 * Read/write/edit: blocked if path is outside the allowed paths (no interactive prompts)
 */
export function createSandboxExtensionFactory(
	workspacePath: string,
): ExtensionFactory {
	const sessionConfig = buildSessionSandboxConfig(workspacePath);
	const allowedPaths = [workspacePath, "/tmp"];

	return (pi) => {
		const bashTool = createBashTool(workspacePath, {
			operations: createSandboxedBashOps(sessionConfig),
		});

		pi.registerTool({
			...bashTool,
			label: "bash (sandboxed)",
			async execute(id, params, signal, onUpdate) {
				return bashTool.execute(id, params, signal, onUpdate);
			},
		});

		pi.on("tool_call", async (event) => {
			if (isToolCallEventType("read", event)) {
				if (!matchesAllowedPath(event.input.path, allowedPaths)) {
					logger.debug("Sandbox blocked read", {
						path: event.input.path,
						allowedPaths: allowedPaths.join(", "),
					});
					return {
						block: true,
						reason: `Sandbox: read access denied for "${event.input.path}"`,
					};
				}
			}

			if (
				isToolCallEventType("write", event) ||
				isToolCallEventType("edit", event)
			) {
				const path = (event.input as { path: string }).path;
				if (!matchesAllowedPath(path, allowedPaths)) {
					logger.debug("Sandbox blocked write/edit", {
						path,
						allowedPaths: allowedPaths.join(", "),
					});
					return {
						block: true,
						reason: `Sandbox: write access denied for "${path}"`,
					};
				}
			}
		});

		logger.info("Sandbox extension registered for session", {
			workspacePath,
			allowedPaths: allowedPaths.join(", "),
		});
	};
}
