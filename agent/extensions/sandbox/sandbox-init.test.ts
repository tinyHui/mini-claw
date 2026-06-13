import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInitialize = vi.fn();
const mockReset = vi.fn();

vi.mock("@carderne/sandbox-runtime", () => ({
	SandboxManager: {
		initialize: (...args: unknown[]) => mockInitialize(...args),
		reset: (...args: unknown[]) => mockReset(...args),
	},
}));

vi.mock("../../logger.js", () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

describe("sandbox-init", () => {
	const originalPlatform = process.platform;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		mockInitialize.mockResolvedValue(undefined);
		mockReset.mockResolvedValue(undefined);
	});

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	it("initializes sandbox on supported platforms", async () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		const { ensureSandboxInitialized } = await import("./sandbox-init.js");

		const result = await ensureSandboxInitialized();

		expect(result).toBe(true);
		expect(mockInitialize).toHaveBeenCalledTimes(1);
		const config = mockInitialize.mock.calls[0][0];
		expect(config.network.allowedDomains).toBeDefined();
		expect(config.filesystem.allowWrite).toContain("/tmp");
	});

	it("returns false on unsupported platforms", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const { ensureSandboxInitialized } = await import("./sandbox-init.js");

		const result = await ensureSandboxInitialized();

		expect(result).toBe(false);
		expect(mockInitialize).not.toHaveBeenCalled();
	});

	it("returns false when initialization fails", async () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		mockInitialize.mockRejectedValue(new Error("missing sandbox-exec"));
		const { ensureSandboxInitialized } = await import("./sandbox-init.js");

		const result = await ensureSandboxInitialized();

		expect(result).toBe(false);
	});

	it("skips re-initialization if already initialized", async () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		const { ensureSandboxInitialized } = await import("./sandbox-init.js");

		await ensureSandboxInitialized();
		await ensureSandboxInitialized();

		expect(mockInitialize).toHaveBeenCalledTimes(1);
	});

	it("resets the sandbox and allows re-initialization", async () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		const { ensureSandboxInitialized, resetSandbox, isSandboxReady } =
			await import("./sandbox-init.js");

		await ensureSandboxInitialized();
		expect(isSandboxReady()).toBe(true);

		await resetSandbox();
		expect(isSandboxReady()).toBe(false);
		expect(mockReset).toHaveBeenCalledTimes(1);
	});

	it("resetSandbox is safe to call when not initialized", async () => {
		const { resetSandbox } = await import("./sandbox-init.js");

		await resetSandbox();

		expect(mockReset).not.toHaveBeenCalled();
	});
});
