/**
 * Mini-Claw sandbox integration — OS-level restrictions for agent commands and
 * tools, using `@carderne/sandbox-runtime` (sandbox-exec on macOS, bubblewrap on Linux).
 * Inspired by upstream [pi-sandbox](https://github.com/carderne/pi-sandbox); this
 * repo does **not** use interactive prompts, `.pi/sandbox.json`, or the Pi CLI extension flow.
 *
 * **Lifecycle**
 * - `ensureSandboxInitialized` / `resetSandbox` / `isSandboxReady` — `SandboxManager` is
 *   initialized once at bot startup (see `src/index.ts`). Unsupported platforms or init
 *   failures skip sandboxing; the agent still runs without these extensions.
 * - Per Telegram session, `pi-runner` builds an isolated cwd under
 *   `MINI_CLAW_SESSION_DIR/<userId>_<sessionId>/` and passes `createSandboxExtensionFactory(isolatedWorkspace)`
 *   into `DefaultResourceLoader.extensionFactories`.
 *
 * **What gets enforced**
 * - **Bash**: each command is wrapped with `SandboxManager.wrapWithSandbox(..., customConfig)` where
 *   `customConfig` comes from `buildSessionSandboxConfig(isolatedWorkspace)` — typically read/write
 *   limited to that directory plus `/tmp`, plus shared deny rules (e.g. home trees) and sensitive
 *   filename patterns from `sandbox-config`.
 * - **read / write / edit tools**: `tool_call` handlers block paths outside the allowed set (same
 *   workspace + `/tmp`); no UI — blocked calls fail with a clear reason string.
 * - **Network**: base allowlists for common package/registry hosts are set in `buildGlobalSandboxConfig`
 *   used during global `initialize()`; per-command overrides follow sandbox-runtime behavior.
 *
 * **Modules**
 * - `sandbox-config` — builds `SandboxRuntimeConfig` / session partial config.
 * - `sandbox-init` — process-wide init and shutdown.
 * - `sandbox-factory` — Pi `ExtensionFactory` registering sandboxed bash + path checks.
 *
 * **Requirements (host)**: on Linux, bubblewrap and related tooling expected by sandbox-runtime; see that package’s docs.
 */

export {
	buildGlobalSandboxConfig,
	buildSessionSandboxConfig,
} from "./sandbox-config.js";
export {
	createSandboxExtensionFactory,
} from "./sandbox-factory.js";
export {
	ensureSandboxInitialized,
	isSandboxReady,
	resetSandbox,
} from "./sandbox-init.js";
