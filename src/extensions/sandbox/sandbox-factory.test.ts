import { homedir } from "node:os";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carderne/sandbox-runtime", () => ({
	SandboxManager: {
		wrapWithSandbox: vi.fn(async (command: string) => `sandboxed: ${command}`),
	},
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
	createBashTool: vi.fn((_cwd: string, _opts?: unknown) => ({
		name: "bash",
		description: "bash tool",
		parameters: {},
		execute: vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "ok" }],
			details: {},
		}),
	})),
	isToolCallEventType: vi.fn((toolName: string, event: { toolName: string }) => {
		return event.toolName === toolName;
	}),
}));

vi.mock("../../logger.js", () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

import { createSandboxExtensionFactory } from "./sandbox-factory.js";

describe("sandbox-factory", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates an extension factory function", () => {
		const factory = createSandboxExtensionFactory("/workspace/user1_sess1");
		expect(factory).toBeTypeOf("function");
	});

	describe("extension registration", () => {
		it("registers a sandboxed bash tool and tool_call handler", () => {
			const factory = createSandboxExtensionFactory("/workspace/user1_sess1");

			const mockPi = {
				registerTool: vi.fn(),
				on: vi.fn(),
			};

			factory(mockPi as any);

			expect(mockPi.registerTool).toHaveBeenCalledTimes(1);
			const registeredTool = mockPi.registerTool.mock.calls[0][0];
			expect(registeredTool.label).toBe("bash (sandboxed)");
			expect(registeredTool.name).toBe("bash");

			expect(mockPi.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
		});
	});

	describe("tool_call path enforcement", () => {
		function setupToolCallHandler(workspacePath: string) {
			const factory = createSandboxExtensionFactory(workspacePath);
			const mockPi = {
				registerTool: vi.fn(),
				on: vi.fn(),
			};
			factory(mockPi as any);

			const toolCallHandler = mockPi.on.mock.calls.find(
				(call: unknown[]) => call[0] === "tool_call",
			)?.[1] as (event: unknown) => Promise<{ block: boolean; reason: string } | undefined>;

			return toolCallHandler;
		}

		it("allows reads inside the workspace", async () => {
			const handler = setupToolCallHandler("/workspace/user1_sess1");

			const result = await handler({
				type: "tool_call",
				toolName: "read",
				toolCallId: "tc1",
				input: { path: "/workspace/user1_sess1/file.ts" },
			});

			expect(result).toBeUndefined();
		});

		it("blocks reads outside the workspace", async () => {
			const handler = setupToolCallHandler("/workspace/user1_sess1");

			const result = await handler({
				type: "tool_call",
				toolName: "read",
				toolCallId: "tc1",
				input: { path: "/etc/passwd" },
			});

			expect(result).toEqual({
				block: true,
				reason: expect.stringContaining("read access denied"),
			});
		});

		it("allows reads in /tmp", async () => {
			const handler = setupToolCallHandler("/workspace/user1_sess1");

			const result = await handler({
				type: "tool_call",
				toolName: "read",
				toolCallId: "tc1",
				input: { path: "/tmp/some-file.txt" },
			});

			expect(result).toBeUndefined();
		});

		it("allows writes inside the workspace", async () => {
			const handler = setupToolCallHandler("/workspace/user1_sess1");

			const result = await handler({
				type: "tool_call",
				toolName: "write",
				toolCallId: "tc1",
				input: { path: "/workspace/user1_sess1/output.txt" },
			});

			expect(result).toBeUndefined();
		});

		it("blocks writes outside the workspace", async () => {
			const handler = setupToolCallHandler("/workspace/user1_sess1");

			const result = await handler({
				type: "tool_call",
				toolName: "write",
				toolCallId: "tc1",
				input: { path: "/home/user/secret.txt" },
			});

			expect(result).toEqual({
				block: true,
				reason: expect.stringContaining("write access denied"),
			});
		});

		it("blocks edits outside the workspace", async () => {
			const handler = setupToolCallHandler("/workspace/user1_sess1");

			const result = await handler({
				type: "tool_call",
				toolName: "edit",
				toolCallId: "tc1",
				input: { path: "/etc/hosts" },
			});

			expect(result).toEqual({
				block: true,
				reason: expect.stringContaining("write access denied"),
			});
		});

		it("allows writes to the workspace root itself", async () => {
			const handler = setupToolCallHandler("/workspace/user1_sess1");

			const result = await handler({
				type: "tool_call",
				toolName: "write",
				toolCallId: "tc1",
				input: { path: "/workspace/user1_sess1" },
			});

			expect(result).toBeUndefined();
		});

		it("blocks access to other user workspaces", async () => {
			const handler = setupToolCallHandler("/workspace/user1_sess1");

			const result = await handler({
				type: "tool_call",
				toolName: "read",
				toolCallId: "tc1",
				input: { path: "/workspace/user2_sess2/secrets.txt" },
			});

			expect(result).toEqual({
				block: true,
				reason: expect.stringContaining("read access denied"),
			});
		});

		it("does not block non-file tool calls", async () => {
			const handler = setupToolCallHandler("/workspace/user1_sess1");

			const result = await handler({
				type: "tool_call",
				toolName: "grep",
				toolCallId: "tc1",
				input: { pattern: "foo" },
			});

			expect(result).toBeUndefined();
		});

		it("handles tilde paths by expanding to homedir", async () => {
			const handler = setupToolCallHandler("/workspace/user1_sess1");
			resolve(homedir(), ".ssh/id_rsa");

			const result = await handler({
				type: "tool_call",
				toolName: "read",
				toolCallId: "tc1",
				input: { path: "~/.ssh/id_rsa" },
			});

			expect(result).toEqual({
				block: true,
				reason: expect.stringContaining("read access denied"),
			});
		});
	});
});
