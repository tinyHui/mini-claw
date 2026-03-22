import { describe, expect, it } from "vitest";
import {
	buildGlobalSandboxConfig,
	buildSessionSandboxConfig,
} from "./sandbox-config.js";

describe("sandbox-config", () => {
	describe("buildGlobalSandboxConfig", () => {
		it("returns config with network and filesystem settings", () => {
			const config = buildGlobalSandboxConfig();

			expect(config.network.allowedDomains).toContain("npmjs.org");
			expect(config.network.allowedDomains).toContain("github.com");
			expect(config.network.deniedDomains).toEqual([]);
			expect(config.filesystem.denyRead).toContain("/Users");
			expect(config.filesystem.denyRead).toContain("/home");
			expect(config.filesystem.allowWrite).toContain("/tmp");
			expect(config.filesystem.denyWrite).toContain(".env");
			expect(config.enableWeakerNetworkIsolation).toBe(true);
		});

		it("includes standard package registries in allowed domains", () => {
			const config = buildGlobalSandboxConfig();
			const domains = config.network.allowedDomains;

			expect(domains).toContain("registry.npmjs.org");
			expect(domains).toContain("registry.yarnpkg.com");
			expect(domains).toContain("pypi.org");
		});

		it("blocks sensitive file patterns from writes", () => {
			const config = buildGlobalSandboxConfig();

			expect(config.filesystem.denyWrite).toContain(".env");
			expect(config.filesystem.denyWrite).toContain(".env.*");
			expect(config.filesystem.denyWrite).toContain("*.pem");
			expect(config.filesystem.denyWrite).toContain("*.key");
		});
	});

	describe("buildSessionSandboxConfig", () => {
		it("restricts access to the workspace and /tmp", () => {
			const config = buildSessionSandboxConfig("/sessions/user1_abc123");

			expect(config.filesystem?.allowRead).toEqual([
				"/sessions/user1_abc123",
				"/tmp",
			]);
			expect(config.filesystem?.allowWrite).toEqual([
				"/sessions/user1_abc123",
				"/tmp",
			]);
		});

		it("denies read access to user home directories", () => {
			const config = buildSessionSandboxConfig("/workspace");

			expect(config.filesystem?.denyRead).toContain("/Users");
			expect(config.filesystem?.denyRead).toContain("/home");
		});

		it("blocks sensitive file writes", () => {
			const config = buildSessionSandboxConfig("/workspace");

			expect(config.filesystem?.denyWrite).toContain(".env");
			expect(config.filesystem?.denyWrite).toContain("*.pem");
		});

		it("returns partial config (no network settings)", () => {
			const config = buildSessionSandboxConfig("/workspace");

			expect(config.network).toBeUndefined();
		});
	});
});
