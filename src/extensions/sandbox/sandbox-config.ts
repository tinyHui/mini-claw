import type { SandboxRuntimeConfig } from "@carderne/sandbox-runtime";

const DEFAULT_ALLOWED_DOMAINS = [
	"npmjs.org",
	"*.npmjs.org",
	"registry.npmjs.org",
	"registry.yarnpkg.com",
	"pypi.org",
	"*.pypi.org",
	"github.com",
	"*.github.com",
	"api.github.com",
	"raw.githubusercontent.com",
];

const SENSITIVE_WRITE_PATTERNS = [
	".env",
	".env.*",
	"*.pem",
	"*.key",
	"*.crt",
	"*.cert",
	"*.p12",
	"*.pfx",
	"*.gpg",
	".aws/*",
	".ssh/*",
	"id_rsa",
	"id_rsa.*",
	"id_ed25519",
	"id_ed25519.*",
	".npmrc",
	".dockerconfigjson",
	".github_token",
	"*.secrets.*",
	"*.secret.*",
];

/**
 * Base config used for the global SandboxManager.initialize() call.
 * Sets up network proxies and a restrictive default filesystem policy.
 * Per-session filesystem overrides are applied via wrapWithSandbox(customConfig).
 */
export function buildGlobalSandboxConfig(): SandboxRuntimeConfig {
	return {
		network: {
			allowedDomains: DEFAULT_ALLOWED_DOMAINS,
			deniedDomains: [],
		},
		filesystem: {
			denyRead: [
				"/Users",             // macOS user home dirs
				"/home",              // Linux user home dirs
				"/root",              // Linux root home
				"/etc",               // system config (both OSes)
				"/var",               // system/application data
				"/opt",               // third-party apps
				"/Library",           // macOS system library
				"/System",            // macOS core system
				"/private",           // macOS & some Linux systems
				"/bin",               // essential user binaries
				"/sbin",              // system binaries
				"/usr",               // user binaries and shared data
				"/proc",              // Linux/Unix virtual proc fs
				"/dev",               // devices
				"/Volumes",           // macOS mount points
			],
			allowRead: ["/tmp"],
			allowWrite: ["/tmp"],
			denyWrite: SENSITIVE_WRITE_PATTERNS,
		},
		enableWeakerNetworkIsolation: true,
	};
}

/**
 * Per-session filesystem config passed as customConfig to wrapWithSandbox().
 * Restricts access to the session workspace and /tmp only.
 */
export function buildSessionSandboxConfig(
	workspacePath: string,
): Partial<SandboxRuntimeConfig> {
	return {
		filesystem: {
			// Deny read access to important user/system folders on Linux and macOS
			denyRead: [
				"/Users",             // macOS user home dirs
				"/home",              // Linux user home dirs
				"/root",              // Linux root home
				"/etc",               // system config (both OSes)
				"/var",               // system/application data
				"/opt",               // third-party apps
				"/Library",           // macOS system library
				"/System",            // macOS core system
				"/private",           // macOS & some Linux systems
				"/bin",               // essential user binaries
				"/sbin",              // system binaries
				"/usr",               // user binaries and shared data
				"/proc",              // Linux/Unix virtual proc fs
				"/dev",               // devices
				"/Volumes",           // macOS mount points
			],
			allowRead: [workspacePath, "/tmp"],
			allowWrite: [workspacePath, "/tmp"],
			denyWrite: SENSITIVE_WRITE_PATTERNS,
		},
	};
}
