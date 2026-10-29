import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DaemonConfig } from "../src/bridge-types.ts";
import {
	type ChildLike,
	cliArgv,
	parseJsonOutput,
	recordDaemonStart,
	recordError,
	recordSetupApply,
	type ReportPorts,
	reportAgree,
	parseReportThread,
	parseSendRequest,
	reportConsent,
	reportSend,
	reportSendWith,
	resetRecorded,
	runCli,
	type SpawnLike,
} from "../src/features/report.ts";

/** A scripted child process: emits stdout/stderr and exits, or hangs until killed. */
type Script = { stdout?: string; stderr?: string; code?: number; hang?: boolean; spawnThrows?: string; onSpawn?: (args: readonly string[]) => void };

type Call = { file: string; args: readonly string[]; env: NodeJS.ProcessEnv; context?: unknown; contextMode?: number };

function fakeSpawn(script: (args: readonly string[]) => Script, calls: Call[]): SpawnLike {
	return (file, args, options) => {
		const s = script(args);
		if (s.spawnThrows) throw new Error(s.spawnThrows);
		const call: Call = { file, args, env: options.env };
		const index = args.indexOf("--context-file");
		if (index >= 0) {
			const path = args[index + 1]!;
			call.context = JSON.parse(readFileSync(path, "utf8"));
			call.contextMode = statSync(path).mode & 0o777;
		}
		calls.push(call);
		s.onSpawn?.(args);
		const child = new EventEmitter() as EventEmitter & ChildLike & { killed: NodeJS.Signals[] };
		const stdout = new EventEmitter();
		const stderr = new EventEmitter();
		Object.assign(child, { stdout, stderr, killed: [] as NodeJS.Signals[] });
		child.kill = (signal?: NodeJS.Signals) => {
			child.killed.push(signal ?? "SIGTERM");
			if (signal === "SIGKILL") queueMicrotask(() => child.emit("close", null, "SIGKILL"));
			return true;
		};
		if (!s.hang) {
			queueMicrotask(() => {
				if (s.stdout) stdout.emit("data", Buffer.from(s.stdout));
				if (s.stderr) stderr.emit("data", Buffer.from(s.stderr));
				child.emit("close", s.code ?? 0, null);
			});
		}
		return child;
	};
}

let dir: string;
let calls: Call[];

const config = (over: Partial<DaemonConfig> = {}): DaemonConfig => ({ manifestPath: "/home/u/.config/dinobot/dinobot.yaml", port: 8786, dataDir: "/home/u/.dinobot", workspaceRoot: null, homeDir: "/home/u", command: "/opt/dinobot/bun", bundled: true, ...over });

function ports(script: (args: readonly string[]) => Script, over: Partial<ReportPorts> = {}): ReportPorts {
	return {
		spawn: fakeSpawn(script, calls),
		command: async () => "/app/daemon/node_modules/dinobot/main.js",
		launch: async () => ({ file: "/app/daemon/bun", prefix: ["/app/daemon/node_modules/dinobot/main.js"] }),
		config: async () => config(),
		app: () => ({ name: "dinobot", version: "0.1.3", packaged: true, locale: "ko", versions: { electron: "44.7.2", chrome: "140.0", node: "24.1.0", v8: "14.0" } }),
		daemonLogTail: async () => "last daemon line",
		tmpdir: () => dir,
		env: () => ({ PATH: "/usr/bin", DINOBOT_REPORT_URL: "http://127.0.0.1:9/report" }),
		...over,
	};
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "report-test-"));
	calls = [];
	resetRecorded();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("consent and agree", () => {
	test("consent runs `report consent --json --config <manifest>` through the bundled launch", async () => {
		const result = await reportConsent(ports(() => ({ stdout: JSON.stringify({ version: "report-consent-ko-v2", text: "동의 문구", textSha256: "ab", consented: false, auto: false }) })));
		expect(result).toEqual({ ok: true, version: "report-consent-ko-v2", text: "동의 문구", textSha256: "ab", consented: false, auto: false });
		expect(calls[0]!.file).toBe("/app/daemon/bun");
		expect(calls[0]!.args).toEqual(["/app/daemon/node_modules/dinobot/main.js", "report", "consent", "--json", "--config", "/home/u/.config/dinobot/dinobot.yaml"]);
		expect(calls[0]!.env.DINOBOT_REPORT_URL).toBe("http://127.0.0.1:9/report");
	});
	test("no manifest: --config is left out", async () => {
		await reportConsent(ports(() => ({ stdout: '{"version":"v","text":"t","consented":true,"auto":false}' }), { config: async () => config({ manifestPath: null }) }));
		expect(calls[0]!.args).not.toContain("--config");
	});
	test("a failing or garbled consent call is an error with the stderr tail", async () => {
		const result = await reportConsent(ports(() => ({ stdout: "not json", stderr: "boom\nreason here", code: 1 })));
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error).toContain("reason here");
	});
	test("missing command", async () => {
		const result = await reportConsent(ports(() => ({}), { command: async () => null }));
		expect(result.ok).toBe(false);
		expect(calls).toHaveLength(0);
	});
	test("agree passes the version and --auto; exit 2 is a version mismatch", async () => {
		expect(await reportAgree(ports(() => ({ stdout: '{"receipt":{}}' })), "report-consent-ko-v2", true)).toEqual({ ok: true });
		expect(calls[0]!.args.slice(1, 6)).toEqual(["report", "agree", "report-consent-ko-v2", "--auto", "--json"]);
		expect(await reportAgree(ports(() => ({ stdout: '{"error":"version"}', code: 2 })), "report-consent-ko-v1", false)).toEqual({ ok: false, error: "version", versionMismatch: true });
		expect(calls[1]!.args).not.toContain("--auto");
	});
	test("agree refuses an option-looking version", async () => {
		expect((await reportAgree(ports(() => ({})), "--auto", false)).ok).toBe(false);
		expect(calls).toHaveLength(0);
	});
});

describe("send", () => {
	test("sends with client, trigger, note and a private context file that is removed afterwards", async () => {
		recordSetupApply({ status: "failed", reason: "x", log: "l", text: "dinobot could not start", level: "error", changes: [], summary: [], logPath: "/home/u/.dinobot/dinobot.log" });
		recordDaemonStart({ ok: false, error: "did not come up", logTail: "tail lines" });
		recordError("renderer", new Error("render broke"));
		const result = await reportSendWith(ports(() => ({ stdout: JSON.stringify({ id: "0123456789abcdef", shortId: "01234567", status: "sent", mode: "offline", entries: 12 }) })), { trigger: "setup-failed", note: "  telegram 연결 후 끊겨요 " });
		expect(result).toEqual({ status: "sent", id: "0123456789abcdef", shortId: "01234567", mode: "offline" });
		const call = calls[0]!;
		const args = call.args;
		expect(args.slice(1, 8)).toEqual(["report", "send", "--client", "desktop", "--trigger", "setup-failed", "--context-file"]);
		expect(args).toContain("--note");
		expect(args[args.indexOf("--note") + 1]).toBe("telegram 연결 후 끊겨요");
		expect(args.slice(-3)).toEqual(["--json", "--config", "/home/u/.config/dinobot/dinobot.yaml"]);
		if (process.platform !== "win32") expect(call.contextMode).toBe(0o600);
		const context = call.context as Record<string, any>;
		expect(context.client).toBe("desktop");
		expect(context.trigger).toBe("setup-failed");
		expect(context.app.version).toBe("0.1.3");
		expect(context.versions.electron).toBe("44.7.2");
		expect(context.platform).toBe(process.platform);
		expect(context.lastSetupApply.status).toBe("failed");
		expect(context.lastDaemonStartFailure.error).toBe("did not come up");
		expect(context.lastDaemonStartFailure.logTail).toBe("tail lines");
		expect(context.recentErrors[0].message).toContain("render broke");
		expect(context.daemonLogTail).toBe("last daemon line");
		expect(readdirSync(dir)).toEqual([]);
	});
	test("without a thread there is no --thread; with one it is a single <channel>:<key> value", async () => {
		const sent = () => ports(() => ({ stdout: '{"id":"aaaaaaaa","status":"sent","mode":"daemon"}' }));
		await reportSendWith(sent(), { trigger: "button" });
		expect(calls[0]!.args).not.toContain("--thread");
		await reportSendWith(sent(), { trigger: "button", thread: { channel: "tui", key: "20261015141712-c6fa" } });
		const args = calls[1]!.args;
		expect(args.filter((a) => a === "--thread")).toHaveLength(1);
		expect(args[args.indexOf("--thread") + 1]).toBe("tui:20261015141712-c6fa");
		expect(args.slice(-3)).toEqual(["--json", "--config", "/home/u/.config/dinobot/dinobot.yaml"]);
		// A key may itself contain ':' (the CLI splits at the first one).
		await reportSendWith(sent(), { trigger: "button", thread: { channel: "slack", key: "C123:1700000000.0001" } });
		expect(calls[2]!.args[calls[2]!.args.indexOf("--thread") + 1]).toBe("slack:C123:1700000000.0001");
	});
	test("an invalid thread reaching reportSendWith is dropped, not passed", async () => {
		await reportSendWith(ports(() => ({ stdout: '{"id":"aaaaaaaa","status":"sent"}' })), { trigger: "button", thread: { channel: "--offline", key: "x" } });
		expect(calls[0]!.args).not.toContain("--thread");
		expect(calls[0]!.args).not.toContain("--offline");
	});
	test("pending and failed pass through with the error", async () => {
		expect(await reportSendWith(ports(() => ({ stdout: '{"id":"abcdef0123","status":"pending","error":"network down"}' })), { trigger: "button" })).toEqual({ status: "pending", id: "abcdef0123", shortId: "abcdef01", error: "network down" });
		expect(await reportSendWith(ports(() => ({ stdout: '{"id":"x1","shortId":"x1","status":"failed","error":"413"}', code: 1 })), { trigger: "button" })).toEqual({ status: "failed", id: "x1", shortId: "x1", error: "413" });
	});
	test("exit 3 is consent_required", async () => {
		expect(await reportSendWith(ports(() => ({ stdout: '{"error":"consent_required"}', code: 3 })), { trigger: "daemon-down" })).toEqual({ status: "consent_required" });
	});
	test("a crash without JSON is failed with the stderr tail, and the context file is gone", async () => {
		const result = await reportSendWith(ports(() => ({ stderr: "TypeError: x is undefined", code: 1 })), { trigger: "button" });
		expect(result.status).toBe("failed");
		expect(result.error).toContain("TypeError");
		expect(readdirSync(dir)).toEqual([]);
	});
	test("spawn failure", async () => {
		const result = await reportSendWith(ports(() => ({ spawnThrows: "ENOENT" })), { trigger: "button" });
		expect(result).toEqual({ status: "failed", error: "could not run dinobot: ENOENT" });
		expect(readdirSync(dir)).toEqual([]);
	});
	test("one send at a time: a second request joins the first", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => (release = resolve));
		const p = ports(() => ({ stdout: '{"id":"aaaaaaaa","status":"sent"}' }), { config: async () => (await gate, config()) });
		const first = reportSend(p, { trigger: "button" });
		const second = reportSend(p, { trigger: "button" });
		release();
		expect(await first).toEqual(await second);
		expect(calls).toHaveLength(1);
		await reportSend(p, { trigger: "button" });
		expect(calls).toHaveLength(2);
	});
});

describe("runner", () => {
	test("a hanging child is killed at the timeout", async () => {
		const spawned: ChildLike[] = [];
		const spawn: SpawnLike = (file, args, options) => {
			const child = fakeSpawn(() => ({ hang: true }), calls)(file, args, options);
			spawned.push(child);
			return child;
		};
		const started = Date.now();
		const run = await runCli({ spawn }, "x", [], {}, 50, 20);
		expect(run.timedOut).toBe(true);
		expect((spawned[0] as unknown as { killed: string[] }).killed).toEqual(["SIGTERM", "SIGKILL"]);
		expect(Date.now() - started).toBeLessThan(2_000);
	});
	test("a timed-out send reports the timeout", async () => {
		// SIGTERM ignored, SIGKILL closes: the fake emits close only on SIGKILL.
		const p = ports(() => ({ hang: true }));
		const { SEND_TIMEOUT_MS } = await import("../src/features/report.ts");
		expect(SEND_TIMEOUT_MS).toBe(120_000);
		const run = await runCli(p, "x", [], {}, 10, 10);
		expect(run.timedOut).toBe(true);
	});
	test("JSON output: whole text or the last JSON line after logs", () => {
		expect(parseJsonOutput('{"a":1}')).toEqual({ a: 1 });
		expect(parseJsonOutput('log line\n{"a":1}\n{"b":2}\n')).toEqual({ b: 2 });
		expect(parseJsonOutput("nothing")).toBeUndefined();
		expect(parseJsonOutput("[1]")).toBeUndefined();
	});
	test("the launch prefix comes before the report arguments", async () => {
		const target = await cliArgv({ command: async () => "/src/dinobot/src/main.ts", launch: async (c) => ({ file: "/bin/bun", prefix: [c] }) }, ["report", "consent"]);
		expect(target).toEqual({ file: "/bin/bun", argv: ["/src/dinobot/src/main.ts", "report", "consent"] });
		const exe = await cliArgv({ command: async () => "/usr/bin/dinobot", launch: async (c) => ({ file: c, prefix: [] }) }, ["report"]);
		expect(exe).toEqual({ file: "/usr/bin/dinobot", argv: ["report"] });
	});
	test("errors ring keeps the last 50", () => {
		for (let i = 0; i < 60; i++) recordError("main", `e${i}`);
		// observed through the context
		return reportSendWith(ports(() => ({ stdout: '{"id":"a","status":"sent"}' })), { trigger: "button" }).then(() => {
			const errors = (calls[0]!.context as { recentErrors: { message: string }[] }).recentErrors;
			expect(errors).toHaveLength(50);
			expect(errors[0]!.message).toBe("e10");
			expect(existsSync(join(dir, "x"))).toBe(false);
		});
	});
});

describe("report:send IPC payload", () => {
	test("thread: channel pattern and a bounded key without control characters", () => {
		expect(parseReportThread({ channel: "tui", key: "20261015141712-c6fa" })).toEqual({ channel: "tui", key: "20261015141712-c6fa" });
		expect(parseReportThread({ channel: "slack_2-x", key: "C123-1700000000.0001" })).toEqual({ channel: "slack_2-x", key: "C123-1700000000.0001" });
		expect(parseReportThread({ channel: "a".repeat(32), key: "k" })).toEqual({ channel: "a".repeat(32), key: "k" });
		expect(parseReportThread({ channel: "tui", key: "k".repeat(512) })?.key).toHaveLength(512);
		for (const bad of [
			{ channel: "a".repeat(33), key: "k" },
			{ channel: "Tui", key: "k" },
			{ channel: "1tui", key: "k" },
			{ channel: "-tui", key: "k" },
			{ channel: "", key: "k" },
			{ channel: "tu:i", key: "k" },
			{ channel: "tui", key: "" },
			{ channel: "tui", key: "k".repeat(513) },
			{ channel: "tui", key: "a\nb" },
			{ channel: "tui", key: "a\rb" },
			{ channel: "tui", key: "a\u0000b" },
			{ channel: "tui", key: 5 },
			{ channel: 5, key: "k" },
			{ channel: "tui" },
			"tui:main",
			null,
			undefined,
			[],
		]) expect(parseReportThread(bad)).toBeUndefined();
	});
	test("request: unknown trigger is button, note capped, invalid thread dropped", () => {
		expect(parseSendRequest(null)).toEqual({ trigger: "button" });
		expect(parseSendRequest({ trigger: "rm -rf", note: 3 })).toEqual({ trigger: "button" });
		expect(parseSendRequest({ trigger: "daemon-down", note: "n".repeat(5_000) }).note).toHaveLength(4_000);
		expect(parseSendRequest({ trigger: "setup-failed", note: "x", thread: { channel: "tui", key: "main" } })).toEqual({ trigger: "setup-failed", note: "x", thread: { channel: "tui", key: "main" } });
		expect(parseSendRequest({ trigger: "button", thread: { channel: "tui", key: "a\nb" } })).toEqual({ trigger: "button" });
		expect(parseSendRequest({ trigger: "button", thread: { channel: "tui", key: "main", extra: "--offline" } })).toEqual({ trigger: "button", thread: { channel: "tui", key: "main" } });
	});
});
