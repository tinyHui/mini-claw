import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const STATE_FILE = join(homedir(), ".mini-claw", "workspaces.json");

interface WorkspaceState {
	[channelId: string]: string;
}

let state: WorkspaceState = {};
let loaded = false;

async function ensureStateDir(): Promise<void> {
	await mkdir(dirname(STATE_FILE), { recursive: true });
}

async function loadState(): Promise<void> {
	if (loaded) return;
	try {
		const data = await readFile(STATE_FILE, "utf-8");
		state = JSON.parse(data);
	} catch {
		state = {};
	}
	loaded = true;
}

async function saveState(): Promise<void> {
	await ensureStateDir();
	await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

export async function getWorkspace(channelId: string): Promise<string> {
	await loadState();
	const cwd = state[channelId];
	if (cwd) {
		try {
			const stats = await stat(cwd);
			if (stats.isDirectory()) {
				return cwd;
			}
		} catch {
			// Directory doesn't exist, fall back to home
		}
	}
	return homedir();
}

export async function setWorkspace(
	channelId: string,
	path: string,
): Promise<string> {
	await loadState();

	let resolved = path;
	if (path.startsWith("~")) {
		resolved = join(homedir(), path.slice(1));
	} else if (!path.startsWith("/")) {
		const current = await getWorkspace(channelId);
		resolved = resolve(current, path);
	}

	try {
		await access(resolved);
		const stats = await stat(resolved);
		if (!stats.isDirectory()) {
			throw new Error(`Not a directory: ${resolved}`);
		}
	} catch (err) {
		if (err instanceof Error && err.message.startsWith("Not a directory")) {
			throw err;
		}
		throw new Error(`Directory not found: ${resolved}`, { cause: err });
	}

	state[channelId] = resolved;
	await saveState();
	return resolved;
}

export function formatPath(path: string): string {
	const home = homedir();
	if (path === home) {
		return "~";
	}
	if (path.startsWith(`${home}/`)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}
