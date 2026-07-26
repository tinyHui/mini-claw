/**
 * Workspace-local Pi extension boundary.
 *
 * This extension deliberately exposes draft preparation only. Approval tokens
 * and connector calls live in the daemon and are never registered as model
 * tools. The compatibility spike supplies the pinned Pi API types.
 */
export default function approvalGate(pi: {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(id: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  }): void;
}): void {
  pi.registerTool({
    name: "growth_draft_preview",
    label: "Prepare growth draft",
    description: "Return an exact draft payload for application review. This tool cannot approve or publish.",
    parameters: {
      type: "object",
      required: ["platform", "body"],
      additionalProperties: false,
      properties: {
        platform: { type: "string", enum: ["reddit", "x", "rednote"] },
        body: { type: "string", minLength: 1 },
        target: { type: "string" },
        media: { type: "array", items: { type: "string" } }
      }
    },
    async execute(_id, params) {
      return {
        content: [{ type: "text", text: JSON.stringify({ kind: "draft-preview", ...params }) }],
        details: { externalWrite: false }
      };
    }
  });
}
