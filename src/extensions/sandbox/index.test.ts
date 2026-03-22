import { describe, expect, it } from "vitest";
import {
	buildGlobalSandboxConfig,
	createSandboxExtensionFactory,
	ensureSandboxInitialized,
	isSandboxReady,
	resetSandbox,
} from "./index.js";

describe("sandbox index barrel", () => {
	it("exports config and factory symbols", () => {
		expect(typeof buildGlobalSandboxConfig).toBe("function");
		expect(typeof createSandboxExtensionFactory).toBe("function");
	});

	it("exports lifecycle helpers", () => {
		expect(typeof ensureSandboxInitialized).toBe("function");
		expect(typeof resetSandbox).toBe("function");
		expect(typeof isSandboxReady).toBe("function");
	});
});
