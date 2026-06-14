import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	AuthStorage,
	type AgentSession,
	type AgentSessionEvent,
	ModelRegistry,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import type { Config } from "./config.js";
import {
	createSandboxExtensionFactory,
	isSandboxReady,
} from "./extensions/sandbox/index.js";
import { createCronGeneratorExtensionFactory } from "./extensions/cron/cron-generator-extension.js";
import { logger } from "./logger.js";
import { readWorkspacePrompt } from "./pi-utils.js";
import { resolveSessionHistoryPath } from "./session-history-path.js";
import { mergeRepoSkills } from "./skills.js";

interface RunResult {
	output: string;
	error?: string;
	trace?: string;
}

export type ActivityType =
	| "thinking"
	| "reading"
	| "writing"
	| "running"
	| "searching"
	| "working";

export interface ActivityUpdate {
	type: ActivityType;
	detail: string;
	elapsed: number; // seconds
}

export type ActivityCallback = (activity: ActivityUpdate) => void;

// Placeholder for future queue strategy extension.
const STREAMING_QUEUE_MODE: "followUp" | "steer" = "followUp";

interface PendingRequest {
	startedAt: number;
	onActivity: ActivityCallback;
	resolve: (result: RunResult) => void;
	reject: (error: unknown) => void;
	textDeltas: string[];
	lastAssistantText?: string;
	trace: string[];
	timeout: NodeJS.Timeout;
	heartbeat: NodeJS.Timeout;
}

interface PiRuntime {
	sessionId?: string;
	workspace?: string;
	session?: AgentSession;
	sessionReady?: Promise<AgentSession>;
	queue: PendingRequest[];
	running: boolean;
	unsubscribe?: () => void;
}

class PiSdkRunner {
	private readonly authStorage: AuthStorage;
	private readonly modelRegistry: ModelRegistry;
	private readonly runtime: PiRuntime = {
		queue: [],
		running: false,
	};

	constructor(private readonly config: Config) {
		this.authStorage = AuthStorage.create();
		this.modelRegistry = ModelRegistry.create(this.authStorage);
	}

	async checkAuth(): Promise<boolean> {
		try {
			const available = await this.modelRegistry.getAvailable();
			return available.length > 0;
		} catch {
			return false;
		}
	}

	async runWithStreaming(
		sessionId: string,
		prompt: string,
		workspace: string,
		onActivity: ActivityCallback,
	): Promise<RunResult> {
		const runtime = this.runtime;
		const session = await this.getOrCreateSession(runtime, sessionId, workspace);
		const resultPromise = new Promise<RunResult>((resolve, reject) => {
			const request: PendingRequest = {
				startedAt: Date.now(),
				onActivity,
				resolve,
				reject,
				textDeltas: [],
				trace: [],
				timeout: setTimeout(() => {
					void session.abort().catch(() => {});
					this.failAll(runtime, new Error("Timeout: Pi took too long"));
				}, this.config.piTimeoutMs),
				heartbeat: setInterval(() => {
					const elapsed = Math.floor((Date.now() - request.startedAt) / 1000);
					request.onActivity({ type: "working", detail: "", elapsed });
				}, 5000),
			};
			runtime.queue.push(request);
		});
		const request = runtime.queue[runtime.queue.length - 1];

		if (!runtime.running) {
			runtime.running = true;
			void session.prompt(prompt).catch((error) => {
				this.failAll(runtime, error);
			});
		} else {
			try {
				if (STREAMING_QUEUE_MODE === "followUp") {
					await session.followUp(prompt);
				} else {
					await session.steer(prompt);
				}
			} catch (error) {
				this.removeRequest(runtime, request);
				clearTimeout(request.timeout);
				clearInterval(request.heartbeat);
				return {
					output: "",
					error: `Failed to queue follow-up: ${this.errorMessage(error)}`,
				};
			}
		}

		try {
			return await resultPromise;
		} catch (error) {
			return {
				output: "",
				error: this.errorMessage(error),
			};
		}
	}

	private async getOrCreateSession(
		runtime: PiRuntime,
		sessionId: string,
		workspace: string,
	): Promise<AgentSession> {
		if (runtime.session && runtime.sessionId === sessionId && runtime.workspace === workspace) {
			return runtime.session;
		}

		if (!runtime.sessionReady) {
			runtime.sessionReady = this.createSession(sessionId, workspace);
		}
		const session = await runtime.sessionReady.finally(() => {
			runtime.sessionReady = undefined;
		});

		if (runtime.unsubscribe) {
			runtime.unsubscribe();
		}
		if (runtime.session && runtime.session !== session) {
			runtime.session.dispose();
		}

		runtime.sessionId = sessionId;
		runtime.workspace = workspace;
		runtime.session = session;
		runtime.unsubscribe = session.subscribe((event) => {
			this.handleSessionEvent(runtime, event);
		});

		return session;
	}

	private async createSession(sessionId: string, workspace: string): Promise<AgentSession> {
		const isolatedWorkspace = join(this.config.sessionDir, sessionId);
		await mkdir(isolatedWorkspace, { recursive: true });
		logger.info("Created isolated session workspace", {
			sessionId,
			isolatedWorkspace,
		});

		const sessionManager = await this.getSessionManager(
			isolatedWorkspace,
			sessionId,
		);

		const workspacePrompt = await readWorkspacePrompt(workspace);
		const extensionFactories = [
			createCronGeneratorExtensionFactory({ config: this.config }),
			...(isSandboxReady()
				? [createSandboxExtensionFactory(isolatedWorkspace, [this.config.cronDir])]
				: []),
		];

		const resourceLoader = new DefaultResourceLoader({
			cwd: isolatedWorkspace,
			agentDir: getAgentDir(),
			noExtensions: !isSandboxReady(),
			extensionFactories,
			systemPromptOverride: () => workspacePrompt,
			skillsOverride: (base) => mergeRepoSkills(base, this.config.appRoot),
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: isolatedWorkspace,
			authStorage: this.authStorage,
			modelRegistry: this.modelRegistry,
			thinkingLevel: this.config.thinkingLevel,
			sessionManager,
			resourceLoader,
		});

		return session;
	}

	private async getSessionManager(
		workspace: string,
		sessionId: string,
	): Promise<SessionManager> {
		await mkdir(this.config.sessionDir, { recursive: true });
		const sessionFilePath = await resolveSessionHistoryPath(
			this.config.sessionDir,
			sessionId,
		);
		logger.info("Session history file", {
			sessionFilePath,
			sessionId,
		});
		// create() sets cwd to the isolated workspace; setSessionFile() applies our
		// flat filename under sessionDir (open() would use process.cwd() for new files).
		const sessionManager = SessionManager.create(workspace, this.config.sessionDir);
		sessionManager.setSessionFile(sessionFilePath);
		return sessionManager;
	}

	private handleSessionEvent(runtime: PiRuntime, event: AgentSessionEvent): void {
		const request = runtime.queue[0];
		if (!request) {
			if (event.type === "agent_end") {
				runtime.running = false;
			}
			return;
		}

		this.recordTrace(request, event);
		this.emitActivity(request, event);

		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			request.textDeltas.push(event.assistantMessageEvent.delta);
		}

		if (event.type === "message_end") {
			request.lastAssistantText = this.extractAssistantText(event.message) ?? request.lastAssistantText;
		}

		if (event.type === "agent_end") {
			request.lastAssistantText = this.extractLastAssistantText(event.messages) ?? request.lastAssistantText;
		}

		if (event.type === "agent_end") {
			if (runtime.queue.length > 0) {
				this.resolveHead(runtime);
			}
			runtime.running = false;
		}
	}

	private resolveHead(runtime: PiRuntime): void {
		const request = runtime.queue.shift();
		if (!request) return;
		clearTimeout(request.timeout);
		clearInterval(request.heartbeat);
		const output = request.textDeltas.join("").trim()
			|| request.lastAssistantText
			|| runtime.session?.getLastAssistantText()
			|| "(no output)";
		request.resolve({
			output,
			trace: request.trace.join("\n"),
		});
	}

	private extractLastAssistantText(messages: AgentSessionEvent extends { messages: infer T } ? T : unknown): string | undefined {
		if (!Array.isArray(messages)) return undefined;
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const text = this.extractAssistantText(messages[index]);
			if (text) return text;
		}
		return undefined;
	}

	private extractAssistantText(message: unknown): string | undefined {
		if (!message || typeof message !== "object") return undefined;
		const candidate = message as { role?: unknown; content?: unknown };
		if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) return undefined;
		const text = candidate.content
			.map((content) => {
				if (!content || typeof content !== "object") return "";
				const part = content as { type?: unknown; text?: unknown };
				return part.type === "text" && typeof part.text === "string" ? part.text : "";
			})
			.join("")
			.trim();
		return text || undefined;
	}

	private failAll(runtime: PiRuntime, error: unknown): void {
		const message = this.errorMessage(error);
		while (runtime.queue.length > 0) {
			const request = runtime.queue.shift();
			if (!request) continue;
			clearTimeout(request.timeout);
			clearInterval(request.heartbeat);
			request.resolve({
				output: "",
				error: message,
				trace: request.trace.join("\n"),
			});
		}
		runtime.running = false;
	}

	private removeRequest(runtime: PiRuntime, target: PendingRequest): void {
		const index = runtime.queue.indexOf(target);
		if (index >= 0) {
			runtime.queue.splice(index, 1);
		}
	}

	private emitActivity(request: PendingRequest, event: AgentSessionEvent): void {
		const elapsed = Math.floor((Date.now() - request.startedAt) / 1000);
		if (event.type === "tool_execution_start") {
			request.onActivity({
				type: "running",
				detail: event.toolName,
				elapsed,
			});
			return;
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
			request.onActivity({ type: "thinking", detail: "", elapsed });
			return;
		}
		if (event.type === "agent_start" || event.type === "turn_start") {
			request.onActivity({ type: "working", detail: "", elapsed });
		}
	}

	private recordTrace(request: PendingRequest, event: AgentSessionEvent): void {
		switch (event.type) {
			case "message_update":
				if (event.assistantMessageEvent.type === "text_delta") {
					request.trace.push(`text_delta: ${event.assistantMessageEvent.delta}`);
				}
				if (event.assistantMessageEvent.type === "thinking_delta") {
					request.trace.push(`thinking_delta: ${event.assistantMessageEvent.delta}`);
				}
				return;
			case "tool_execution_start":
				request.trace.push(`tool_start: ${event.toolName}`);
				return;
			case "tool_execution_end":
				request.trace.push(
					`tool_end: ${event.toolName} (${event.isError ? "error" : "ok"})`,
				);
				return;
			default:
				request.trace.push(event.type);
		}
	}

	private errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
}

let runner: PiSdkRunner | undefined;

function getRunner(config: Config): PiSdkRunner {
	if (!runner) {
		runner = new PiSdkRunner(config);
	}
	return runner;
}

export async function runPi(
	config: Config,
	sessionId: string,
	prompt: string,
	workspace: string,
	_files?: string[],
): Promise<RunResult> {
	return getRunner(config).runWithStreaming(
		sessionId,
		prompt,
		workspace,
		() => {},
	);
}

export async function runPiWithStreaming(
	config: Config,
	sessionId: string,
	prompt: string,
	workspace: string,
	onActivity: ActivityCallback,
	_files?: string[],
): Promise<RunResult> {
	return getRunner(config).runWithStreaming(
		sessionId,
		prompt,
		workspace,
		onActivity,
	);
}

export async function checkPiAuth(): Promise<boolean> {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const available = await modelRegistry.getAvailable();
	return available.length > 0;
}
