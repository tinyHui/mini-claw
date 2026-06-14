import type { ActivityUpdate } from "../pi-runner.js";

const activityEmoji: Record<string, string> = {
	thinking: "🧠",
	reading: "📖",
	writing: "✍️",
	running: "⚡",
	searching: "🔍",
	working: "🔄",
};

export function formatActivityStatus(activity: ActivityUpdate): string {
	const emoji = activityEmoji[activity.type] || "🔄";
	const detail = activity.detail ? `\n└─ ${activity.detail}` : "";
	if (activity.elapsed === 0) {
		return `${emoji} Working...`;
	}
	return `${emoji} Working...${detail} (${activity.elapsed}s)`;
}
