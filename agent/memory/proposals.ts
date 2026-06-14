import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db.js";
import { memoryProposals, type MemoryProposalRow } from "../db/schema.js";
import { getMemoryPath, getUserPath } from "../pi-utils.js";

export type MemoryTarget = "MEMORY" | "USER";
export type MemoryProposalStatus = "pending" | "applied" | "rejected";

export interface CreateMemoryProposalInput {
	target: MemoryTarget;
	entry: string;
	rationale: string;
	evidenceMessageIds: string[];
	status: MemoryProposalStatus;
	beforeHash?: string | null;
	afterHash?: string | null;
	appliedAt?: string | null;
	source?: string;
}

let writeChain = Promise.resolve();

export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export function insertMemoryProposal(input: CreateMemoryProposalInput): MemoryProposalRow {
	const now = new Date().toISOString();
	const proposal: MemoryProposalRow = {
		id: randomUUID(),
		createdAt: now,
		target: input.target,
		entry: input.entry,
		rationale: input.rationale,
		evidenceMessageIdsJson: JSON.stringify(input.evidenceMessageIds),
		status: input.status,
		source: input.source ?? "background_review",
		appliedAt: input.appliedAt ?? null,
		beforeHash: input.beforeHash ?? null,
		afterHash: input.afterHash ?? null,
	};

	getDb().insert(memoryProposals).values(proposal).run();
	return proposal;
}

export function listPendingMemoryProposals(): MemoryProposalRow[] {
	return getDb()
		.select()
		.from(memoryProposals)
		.where(eq(memoryProposals.status, "pending"))
		.orderBy(asc(memoryProposals.createdAt))
		.all() as MemoryProposalRow[];
}

export function getMemoryProposal(id: string): MemoryProposalRow | undefined {
	return getDb()
		.select()
		.from(memoryProposals)
		.where(eq(memoryProposals.id, id))
		.get() as MemoryProposalRow | undefined;
}

export function resolvePendingMemoryProposal(idOrPrefix: string): MemoryProposalRow | undefined {
	const exact = getMemoryProposal(idOrPrefix);
	if (exact?.status === "pending") return exact;
	const matches = listPendingMemoryProposals().filter((proposal) =>
		proposal.id.startsWith(idOrPrefix),
	);
	return matches.length === 1 ? matches[0] : undefined;
}

export function rejectMemoryProposal(id: string): boolean {
	const proposal = resolvePendingMemoryProposal(id);
	if (!proposal) return false;
	const result = getDb()
		.update(memoryProposals)
		.set({ status: "rejected" })
		.where(and(eq(memoryProposals.id, proposal.id), eq(memoryProposals.status, "pending")))
		.run();
	return result.changes > 0;
}

function memoryPathForTarget(workspace: string, target: MemoryTarget): string {
	return target === "MEMORY" ? getMemoryPath(workspace) : getUserPath(workspace);
}

async function appendEntryToFile(workspace: string, target: MemoryTarget, entry: string) {
	const path = memoryPathForTarget(workspace, target);
	const before = await readFile(path, "utf-8");
	const beforeHash = hashContent(before);
	const normalized = entry.trim();
	const section = before.includes("## Learned") ? "" : "\n\n## Learned\n";
	const prefix = before.endsWith("\n") ? "" : "\n";
	const after = `${before}${section || prefix}- ${normalized}\n`;
	await writeFile(path, after, "utf-8");
	return { beforeHash, afterHash: hashContent(after) };
}

export function appendMemoryEntry(
	workspace: string,
	target: MemoryTarget,
	entry: string,
): Promise<{ beforeHash: string; afterHash: string }> {
	const next = writeChain.then(() => appendEntryToFile(workspace, target, entry));
	writeChain = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

export async function applyPendingMemoryProposal(
	workspace: string,
	id: string,
): Promise<MemoryProposalRow | undefined> {
	const proposal = resolvePendingMemoryProposal(id);
	if (!proposal) return undefined;
	const { beforeHash, afterHash } = await appendMemoryEntry(
		workspace,
		proposal.target as MemoryTarget,
		proposal.entry,
	);
	const appliedAt = new Date().toISOString();
	getDb()
		.update(memoryProposals)
		.set({ status: "applied", appliedAt, beforeHash, afterHash })
		.where(and(eq(memoryProposals.id, id), eq(memoryProposals.status, "pending")))
		.run();
	return { ...proposal, status: "applied", appliedAt, beforeHash, afterHash };
}

export function getMemoryStatus(): { pending: number; applied: number; rejected: number } {
	const rows = getDb().select().from(memoryProposals).all() as MemoryProposalRow[];
	return {
		pending: rows.filter((row) => row.status === "pending").length,
		applied: rows.filter((row) => row.status === "applied").length,
		rejected: rows.filter((row) => row.status === "rejected").length,
	};
}
