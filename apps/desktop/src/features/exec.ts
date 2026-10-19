import { spawn } from "node:child_process";

export type CommandResult = { readonly code: number; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean };

export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Runs a program without a shell: stdin closed, output capped at 4 MiB per stream (past it the child is killed), a hard
 * timeout. Never blocks the event loop; rejects only when the program cannot be started.
 */
export function runQuiet(argv: readonly string[], cwd: string, timeoutMs: number, env?: Record<string, string>): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const [file, ...args] = argv;
		if (file === undefined) return reject(new Error("empty command"));
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...(env === undefined ? {} : { env: { ...process.env, ...env } }) });
		} catch (error) {
			return reject(error);
		}
		let truncated = false;
		let timedOut = false;
		let settled = false;
		const kill = () => {
			try {
				child.kill();
			} catch {}
		};
		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, timeoutMs);
		const collect = (stream: NodeJS.ReadableStream | null) => {
			const chunks: Buffer[] = [];
			let total = 0;
			stream?.on("data", (chunk: Buffer) => {
				if (truncated) return;
				total += chunk.byteLength;
				if (total > MAX_OUTPUT_BYTES) {
					truncated = true;
					kill();
					return;
				}
				chunks.push(chunk);
			});
			return () => Buffer.concat(chunks).toString("utf8");
		};
		const stdout = collect(child.stdout);
		const stderr = collect(child.stderr);
		child.once("error", (error) => {
			clearTimeout(timer);
			if (settled) return;
			settled = true;
			reject(error);
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			if (settled) return;
			settled = true;
			const exit = code ?? 1;
			resolve({
				code: truncated && exit === 0 ? 137 : exit,
				stdout: stdout(),
				stderr: truncated ? `output exceeded ${MAX_OUTPUT_BYTES / (1024 * 1024)} MB` : stderr(),
				timedOut,
			});
		});
	});
}

/** Repository config must never run code: no external diff/textconv drivers, fsmonitor, pager or prompts. */
export const GIT_HARDENING = ["-c", "core.fsmonitor=false", "-c", "core.pager=cat", "-c", "diff.external=", "--no-pager"] as const;
export const GIT_ENV: Record<string, string> = { GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", GIT_EXTERNAL_DIFF: "", GIT_OPTIONAL_LOCKS: "0" };

export function runGit(args: readonly string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
	return runQuiet(["git", ...GIT_HARDENING, ...args], cwd, timeoutMs, GIT_ENV);
}

/** The checked-out branch of `cwd` (`HEAD` when detached), or null outside a repository or when git is missing. */
export async function gitBranch(cwd: string): Promise<string | null> {
	try {
		const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd, 2_000);
		const branch = result.stdout.trim();
		return result.code === 0 && !result.timedOut && branch !== "" ? branch : null;
	} catch {
		return null;
	}
}
