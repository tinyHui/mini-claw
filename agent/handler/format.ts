import type { ActivityUpdate } from "../pi-runner.js";
import type { ProgressStep, ProgressStepType } from "./types.js";

const progressEmoji: Record<ProgressStepType, string> = {
	planning: "📝",
	thinking: "🧠",
	tool: "🛠️",
	shell: "⚡",
	coding: "💻",
	skill: "🧩",
	review: "📖",
	memory: "🧠",
	command: "⌨️",
	message: "💬",
	working: "🔄",
};

const progressVerbs = [
	"Working",
	"Processing",
	"Handling",
	"Checking",
	"Running",
];

interface StoredProgressStep {
	type: ProgressStepType;
	description: string;
}

export function chooseProgressVerb(random = Math.random): string {
	const index = Math.floor(random() * progressVerbs.length);
	return progressVerbs[Math.max(0, Math.min(index, progressVerbs.length - 1))] ?? "Working";
}

export class ProgressMessageState {
	private readonly steps = new Map<string, StoredProgressStep>();
	private latestType: ProgressStepType = "working";

	constructor(
		private readonly startedAt = Date.now(),
		private readonly verb = chooseProgressVerb(),
	) {}

	addStep(step: ProgressStep): boolean {
		const description = step.description.trim();
		if (!description) return false;

		const key = step.key ?? description;
		const current = this.steps.get(key);
		this.latestType = step.type;
		if (current?.type === step.type && current.description === description) {
			return false;
		}

		this.steps.set(key, { type: step.type, description });
		return true;
	}

	addActivity(activity: ActivityUpdate): boolean {
		const step = progressStepFromActivity(activity);
		return step ? this.addStep(step) : false;
	}

	render(now = Date.now()): string {
		const elapsed = Math.max(0, Math.floor((now - this.startedAt) / 1000));
		const header = `${progressEmoji[this.latestType]} ${this.verb}... (${elapsed}s)`;
		const lines = [...this.steps.values()].map((step) => `|-${step.description}`);
		return [header, ...lines].join("\n");
	}
}

export function progressStepFromActivity(activity: ActivityUpdate): ProgressStep | undefined {
	if (activity.type === "thinking") {
		return {
			type: "planning",
			description: "Planning",
			key: "pi:planning",
		};
	}

	if (activity.type === "running" && activity.detail) {
		const toolName = activity.detail.trim();
		if (!toolName) return undefined;
		if (toolName === "bash" || toolName === "exec_command") {
			return {
				type: "shell",
				description: `Running ${toolName}`,
				key: `tool:${toolName}`,
			};
		}
		if (toolName.toLowerCase().includes("skill")) {
			return {
				type: "skill",
				description: `Using skill ${toolName}`,
				key: `tool:${toolName}`,
			};
		}
		if (toolName.toLowerCase().includes("codex")) {
			return {
				type: "coding",
				description: "Coding",
				key: `tool:${toolName}`,
			};
		}
		return {
			type: "tool",
			description: `Using ${toolName}`,
			key: `tool:${toolName}`,
		};
	}

	if (activity.type === "working" && activity.detail) {
		return {
			type: "working",
			description: activity.detail,
			key: "pi:working",
		};
	}

	return undefined;
}
