import { describe, expect, it } from "vitest";
import {
	ProgressMessageState,
	chooseProgressVerb,
	progressStepFromActivity,
} from "./format.js";

describe("ProgressMessageState", () => {
	it("renders a stable verb, elapsed time, and free-form step descriptions", () => {
		const state = new ProgressMessageState(1000, "Handling");

		state.addStep({
			type: "message",
			description: "Handling message with custom detail",
		});
		state.addStep({
			type: "shell",
			description: "Running bash: pnpm test",
		});

		expect(state.render(3500)).toBe([
			"⚡ Handling... (2s)",
			"|-Handling message with custom detail",
			"|-Running bash: pnpm test",
		].join("\n"));
	});

	it("updates a keyed step without appending a duplicate line", () => {
		const state = new ProgressMessageState(0, "Working");

		state.addStep({ type: "review", description: "Reviewing 1 processed message", key: "review" });
		state.addStep({ type: "review", description: "Reviewing 2 processed messages", key: "review" });

		expect(state.render(1000)).toBe([
			"📖 Working... (1s)",
			"|-Reviewing 2 processed messages",
		].join("\n"));
	});
});

describe("chooseProgressVerb", () => {
	it("uses the supplied random source for deterministic selection", () => {
		expect(chooseProgressVerb(() => 0)).toBe("Working");
		expect(chooseProgressVerb(() => 0.99)).toBe("Running");
	});
});

describe("progressStepFromActivity", () => {
	it("maps Pi activity into semantic progress steps", () => {
		expect(progressStepFromActivity({ type: "thinking", detail: "", elapsed: 0 })).toMatchObject({
			type: "planning",
			description: "Planning",
		});
		expect(progressStepFromActivity({ type: "running", detail: "bash", elapsed: 3 })).toMatchObject({
			type: "shell",
			description: "Running bash",
		});
		expect(progressStepFromActivity({ type: "running", detail: "codex", elapsed: 3 })).toMatchObject({
			type: "coding",
			description: "Coding",
		});
	});
});
