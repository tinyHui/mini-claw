import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { CommandProcessor } from "./command-processor.js";
import type { ProcessorContext } from "./types.js";

const {
	mockExistsSync,
	mockRestartCronPm2,
	mockGetSqlite,
	mockEnsureSession,
	mockResetSession,
	mockGetWorkspace,
	mockFormatPath,
	mockListPendingMemoryProposals,
	mockGetMemoryStatus,
	mockApplyPendingMemoryProposal,
	mockRejectMemoryProposal,
} = vi.hoisted(() => ({
	mockExistsSync: vi.fn(),
	mockRestartCronPm2: vi.fn(),
	mockGetSqlite: vi.fn(),
	mockEnsureSession: vi.fn(),
	mockResetSession: vi.fn(),
	mockGetWorkspace: vi.fn(),
	mockFormatPath: vi.fn(),
	mockListPendingMemoryProposals: vi.fn(),
	mockGetMemoryStatus: vi.fn(),
	mockApplyPendingMemoryProposal: vi.fn(),
	mockRejectMemoryProposal: vi.fn(),
}));

vi.mock("node:fs", () => ({
	existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock("../cron/pm2.js", () => ({
	restartCronPm2: (...args: unknown[]) => mockRestartCronPm2(...args),
}));

vi.mock("../db.js", () => ({
	getSqlite: () => mockGetSqlite(),
}));

vi.mock("../logger.js", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
	},
	withLogContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));

vi.mock("../session-repository.js", () => ({
	ensureSession: mockEnsureSession,
	resetSession: mockResetSession,
}));

vi.mock("../workspace.js", () => ({
	getWorkspace: (...args: unknown[]) => mockGetWorkspace(...args),
	formatPath: (...args: unknown[]) => mockFormatPath(...args),
}));

vi.mock("../memory/proposals.js", () => ({
	listPendingMemoryProposals: () => mockListPendingMemoryProposals(),
	getMemoryStatus: () => mockGetMemoryStatus(),
	applyPendingMemoryProposal: (...args: unknown[]) => mockApplyPendingMemoryProposal(...args),
	rejectMemoryProposal: (...args: unknown[]) => mockRejectMemoryProposal(...args),
}));

interface CronTestRow {
	name: string;
	description?: string;
	cronExpression: string;
	enabled: number;
}

function makeConfig(): Config {
	return {
		telegramToken: "fake-token",
		appRoot: "/app",
		cronDir: "/app/generated/cron",
		workspace: "/tmp/ws",
		sessionDir: "/tmp/sessions",
		logLevel: "debug",
		thinkingLevel: "low",
		telegramUserId: 123,
		rateLimitCooldownMs: 5000,
		piTimeoutMs: 300000,
		shellTimeoutMs: 60000,
		sessionTitleTimeoutMs: 10000,
		memoryReviewEnabled: true,
		memoryReviewIntervalMs: 3600000,
		memoryReviewBatchLimit: 40,
	};
}

function makeContext(overrides: Partial<ProcessorContext> = {}): ProcessorContext {
	return {
		config: makeConfig(),
		sessionId: "session-1",
		progress: {
			step: vi.fn().mockResolvedValue(undefined),
			activity: vi.fn().mockResolvedValue(undefined),
		},
		...overrides,
	};
}

function mockCronDb(rows: CronTestRow[]) {
	const updateRun = vi.fn((enabled: number, name: string) => {
		const row = rows.find((item) => item.name === name);
		if (row) row.enabled = enabled;
	});
	const prepare = vi.fn((sql: string) => {
		if (sql.includes("UPDATE cron_jobs SET enabled")) {
			return { run: updateRun };
		}
		if (sql.includes("WHERE name = ?")) {
			return {
				get: (name: string) => rows.find((row) => row.name === name),
			};
		}
		return {
			all: () => rows,
		};
	});
	mockGetSqlite.mockReturnValue({ prepare });
	return { updateRun };
}

describe("CommandProcessor", () => {
	let processor: CommandProcessor;

	beforeEach(() => {
		vi.clearAllMocks();
		processor = new CommandProcessor();
		mockResetSession.mockReturnValue({ id: "new-session" });
		mockEnsureSession.mockReturnValue({ id: "session-123456789" });
		mockGetWorkspace.mockResolvedValue("/tmp/ws");
		mockFormatPath.mockImplementation((path: string) => path);
		mockRestartCronPm2.mockResolvedValue({
			ok: true,
			processName: "mini-claw-cron",
			command: "pm2 startOrReload ecosystem.config.cjs --only mini-claw-cron --update-env",
			stdout: "",
			stderr: "",
		});
		mockListPendingMemoryProposals.mockReturnValue([]);
		mockGetMemoryStatus.mockReturnValue({ pending: 0, applied: 0, rejected: 0 });
		mockApplyPendingMemoryProposal.mockResolvedValue(undefined);
		mockRejectMemoryProposal.mockReturnValue(false);
		mockExistsSync.mockReturnValue(true);
		mockCronDb([]);
	});

	it("resets the session for /new", async () => {
		const result = await processor.process({
			kind: "command",
			chatId: "123",
			telegramMessageId: "1",
			text: "/new",
			command: "new",
			args: [],
		}, makeContext());

		expect(mockResetSession).toHaveBeenCalledOnce();
		expect(result.content).toBe("New session started.");
	});

	it("enables a cron job and restarts the cron process", async () => {
		const db = mockCronDb([{ name: "digest", cronExpression: "0 8 * * *", enabled: 0 }]);

		const result = await processor.process({
			kind: "command",
			chatId: "123",
			telegramMessageId: "1",
			text: "/cron enable digest",
			command: "cron",
			args: ["enable", "digest"],
		}, makeContext());

		expect(mockExistsSync).toHaveBeenCalledWith("/app/generated/cron/jobs/digest.mjs");
		expect(db.updateRun).toHaveBeenCalledWith(1, "digest");
		expect(mockRestartCronPm2).toHaveBeenCalledWith({ appRoot: "/app" });
		expect(result.content).toBe("Cron job digest enabled. Restarted mini-claw-cron.");
	});

	it("streams /memory run progress through the shared reporter", async () => {
		const progressStep = vi.fn().mockResolvedValue(undefined);
		const runOnce = vi.fn(async (onProgress?: (message: string) => Promise<void> | void) => {
			await onProgress?.("Preparing workspace memory files.");
			await onProgress?.("Reviewing 2 processed messages.");
			return {
				status: "completed" as const,
				reviewedMessages: 2,
				accepted: 1,
				staged: 1,
				rejected: 0,
			};
		});

		const result = await processor.process({
			kind: "command",
			chatId: "123",
			telegramMessageId: "1",
			text: "/memory run",
			command: "memory",
			args: ["run"],
		}, makeContext({
			progress: {
				step: progressStep,
				activity: vi.fn().mockResolvedValue(undefined),
			},
			memoryWorker: {
				runOnce,
				stop: vi.fn(),
				getLastReviewAt: vi.fn(),
			},
		}));

		expect(runOnce).toHaveBeenCalledOnce();
		expect(progressStep).toHaveBeenCalledWith(expect.objectContaining({
			description: "Starting manual memory review",
			type: "memory",
		}));
		expect(progressStep).toHaveBeenCalledWith(expect.objectContaining({
			description: "Reviewing 2 processed messages",
			type: "review",
		}));
		expect(result.content).toContain("Applied 1, staged 1, rejected 0.");
	});
});
