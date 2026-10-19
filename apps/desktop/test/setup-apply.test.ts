import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ManifestApplyRequest } from "../src/bridge-types.ts";
import { type ApplyPorts, journalPath, setupApply, setupRecover, sha256Hex } from "../src/features/setup-apply.ts";

/**
 * A fake daemon on a real loopback HTTP server (GET /v1/daemon, POST /v1/daemon/shutdown) plus fake processes: nothing
 * here starts dinobot or touches the user's manifest.
 */
type Fake = {
	pid: number;
	sha: string;
	owner: "tui" | "external";
	busy: string[];
	manifestPath: string;
	up: boolean;
	old: boolean;
	refuse?: { status: "refused"; error: "external" | "pid" | "busy"; busy?: string[] };
	/** The daemon ignores shutdown (stuck). */
	ignoreShutdown: boolean;
	alive: Set<number>;
	/** Decides whether a spawned daemon booting from `text` comes up. */
	boots: (text: string) => boolean;
	spawned: string[];
	shutdowns: number[];
};

const BASE = "bot:\n  dataDir: ./data\napi:\n  port: 8786\nmodel:\n  provider: openai\n";
const CANDIDATE = `${BASE}channels:\n  telegram: {}\n`;
const limits = { stopMs: 400, startMs: 600, pollMs: 10 };

let dir: string;
let manifest: string;
let fake: Fake;
let server: ReturnType<typeof Bun.serve>;
let nextPid: number;

function request(overrides: Partial<ManifestApplyRequest> = {}): ManifestApplyRequest {
	return { manifestPath: manifest, baseSha256: sha256Hex(BASE), candidate: CANDIDATE, changes: ["+ channels.telegram"], summary: ["Telegram is ready."], locale: "en_US.UTF-8", ...overrides };
}

const ports = (): Partial<ApplyPorts> => ({
	alive: (pid) => fake.alive.has(pid),
	kill: (pid) => {
		fake.alive.delete(pid);
	},
	spawn: async (path) => {
		const pid = nextPid++;
		const text = await readFile(path, "utf8");
		fake.spawned.push(text);
		if (!fake.boots(text)) return { pid, exited: () => true };
		fake.alive.add(pid);
		fake.pid = pid;
		fake.sha = sha256Hex(text);
		fake.up = true;
		return { pid, exited: () => false };
	},
	logTail: async () => "boot error: telegram token missing",
});

const run = (req = request()) => setupApply(req, { pid: fake.pid, owner: fake.owner }, server.port!, { overrides: ports(), limits, dataDir: join(dir, "data") });

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "dinobot-apply-"));
	mkdirSync(join(dir, "cfg"));
	manifest = join(dir, "cfg", "dinobot.yaml");
	writeFileSync(manifest, BASE);
	nextPid = 5000;
	fake = {
		pid: 4000,
		sha: sha256Hex(BASE),
		owner: "tui",
		busy: [],
		manifestPath: realpathSync(manifest),
		up: true,
		old: false,
		ignoreShutdown: false,
		alive: new Set([4000]),
		boots: () => true,
		spawned: [],
		shutdowns: [],
	};
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: async (req) => {
			const url = new URL(req.url);
			if (!fake.up) return new Response("down", { status: 503 });
			if (fake.old) return new Response("not found", { status: 404 });
			if (req.method === "GET" && url.pathname === "/v1/daemon") {
				return Response.json({ pid: fake.pid, version: "0.7.13", manifestPath: fake.manifestPath, manifestSha256: fake.sha, owner: fake.owner, startedAt: new Date().toISOString(), busy: fake.busy, setup: {} });
			}
			if (req.method === "POST" && url.pathname === "/v1/daemon/shutdown") {
				const { pid } = (await req.json()) as { pid: number };
				fake.shutdowns.push(pid);
				if (fake.refuse) return Response.json(fake.refuse, { status: 409 });
				if (!fake.ignoreShutdown) {
					fake.up = false;
					setTimeout(() => fake.alive.delete(pid), 20);
				}
				return Response.json({ status: "stopping" }, { status: 202 });
			}
			return new Response("no", { status: 404 });
		},
	});
});

afterEach(() => {
	server.stop(true);
	rmSync(dir, { recursive: true, force: true });
});

const disk = () => readFileSync(manifest, "utf8");
const journalLeft = () => existsSync(journalPath(manifest));

describe("setupApply", () => {
	test("applied: CAS write with .bak, graceful shutdown, new daemon verified", async () => {
		const outcome = await run();
		expect(outcome.status).toBe("applied");
		expect(outcome.level).toBe("success");
		expect(outcome.text).toBe("Setup applied; dinobot restarted with the new settings.\n+ channels.telegram\nTelegram is ready.");
		expect(outcome.changes).toEqual(["+ channels.telegram"]);
		expect(outcome.summary).toEqual(["Telegram is ready."]);
		expect(outcome.logPath).toBe(join(dir, "data", "dinobot.log"));
		expect(disk()).toBe(CANDIDATE);
		expect(readFileSync(`${manifest}.bak`, "utf8")).toBe(BASE);
		expect(fake.shutdowns).toEqual([4000]);
		expect(fake.pid).toBe(5000);
		expect(fake.sha).toBe(sha256Hex(CANDIDATE));
		expect(journalLeft()).toBe(false);
	});

	test("applied without a restart when nothing changed", async () => {
		const outcome = await run(request({ candidate: BASE }));
		expect(outcome.status).toBe("applied");
		expect(fake.shutdowns).toEqual([]);
	});

	test("conflict: the file changed since the wizard read it", async () => {
		const outcome = await run(request({ baseSha256: sha256Hex("something else") }));
		expect(outcome).toMatchObject({ status: "conflict", level: "error", text: "dinobot.yaml changed while setup was running, so nothing was saved. Run /setup again." });
		expect(disk()).toBe(BASE);
	});

	test("invalid: the candidate does not parse", async () => {
		const outcome = await run(request({ candidate: "bot: [unclosed\n" }));
		expect(outcome.status).toBe("invalid");
		if (outcome.status !== "invalid") throw new Error("unreachable");
		expect(outcome.problems.length).toBeGreaterThan(0);
		expect(outcome.text.startsWith("The new settings did not validate, so nothing was saved:\n- ")).toBe(true);
		expect(disk()).toBe(BASE);
	});

	test("unsafe_change: dataDir or api.port would move", async () => {
		expect((await run(request({ candidate: BASE.replace("8786", "9999") }))).status).toBe("unsafe_change");
		expect((await run(request({ candidate: BASE.replace("./data", "./elsewhere") }))).status).toBe("unsafe_change");
		expect(disk()).toBe(BASE);
	});

	test("unreachable and older_daemon", async () => {
		const port = server.port!;
		server.stop(true);
		const unreachable = await setupApply(request(), { pid: 4000, owner: "tui" }, port, { overrides: ports(), limits, dataDir: null });
		expect(unreachable).toMatchObject({ status: "unreachable", text: "Could not reach the dinobot daemon, so nothing was changed.", logPath: null });
		server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("nope", { status: 404 }) });
		expect((await run()).status).toBe("older_daemon");
		expect(disk()).toBe(BASE);
	});

	test("other_manifest", async () => {
		fake.manifestPath = join(dir, "other.yaml");
		const outcome = await run();
		expect(outcome).toMatchObject({ status: "other_manifest", path: join(dir, "other.yaml") });
		expect(outcome.text).toBe(`The running daemon uses another manifest (${join(dir, "other.yaml")}), so nothing was changed.`);
	});

	test("saved_external: an external daemon gets the file saved but is not restarted", async () => {
		fake.owner = "external";
		const outcome = await run();
		expect(outcome.status).toBe("saved_external");
		expect(outcome.level).toBe("info");
		expect(outcome.text.split("\n")[0]).toBe(`Saved ${manifest}. This dinobot daemon is managed outside the TUI (for example by systemd), so restart that service to apply the changes.`);
		expect(disk()).toBe(CANDIDATE);
		expect(readFileSync(`${manifest}.bak`, "utf8")).toBe(BASE);
		expect(fake.shutdowns).toEqual([]);
	});

	test("busy: before the write, and when the daemon refuses the shutdown", async () => {
		fake.busy = ["tui:a", "tui:b"];
		const before = await run();
		expect(before).toMatchObject({ status: "busy", threads: ["tui:a", "tui:b"], text: "Some conversations are still working (tui:a, tui:b). Nothing was changed; run /setup again when they finish." });
		expect(disk()).toBe(BASE);
		fake.busy = [];
		fake.refuse = { status: "refused", error: "busy", busy: ["tui:c"] };
		const refused = await run();
		expect(refused).toMatchObject({ status: "busy", threads: ["tui:c"] });
		expect(disk()).toBe(BASE);
		expect(journalLeft()).toBe(false);
	});

	test("stuck: the old daemon does not exit; previous settings restored, nothing spawned", async () => {
		fake.ignoreShutdown = true;
		const outcome = await run();
		expect(outcome).toMatchObject({ status: "stuck", pid: 4000 });
		expect(outcome.text).toContain("(pid 4000) did not stop in time");
		expect(disk()).toBe(BASE);
		expect(fake.spawned).toEqual([]);
		expect(journalLeft()).toBe(false);
	});

	test("rolled_back: the new settings do not boot, the previous ones do", async () => {
		fake.boots = (text) => text === BASE;
		const outcome = await run();
		expect(outcome).toMatchObject({ status: "rolled_back", reason: "the daemon exited during startup", log: "boot error: telegram token missing" });
		expect(outcome.text).toBe("dinobot could not start with the new settings (the daemon exited during startup). The previous settings were restored and dinobot is running again.\nboot error: telegram token missing");
		expect(disk()).toBe(BASE);
		expect(fake.spawned).toEqual([CANDIDATE, BASE]);
		expect(fake.sha).toBe(sha256Hex(BASE));
		expect(journalLeft()).toBe(false);
	});

	test("failed: neither the new nor the previous settings boot", async () => {
		fake.boots = () => false;
		const outcome = await run();
		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") throw new Error("unreachable");
		expect(outcome.reason).toBe("the daemon exited during startup; the previous settings did not start either (the daemon exited during startup)");
		expect(outcome.text.startsWith("dinobot could not start (")).toBe(true);
		expect(disk()).toBe(BASE);
		expect(journalLeft()).toBe(false);
	});

	test("Korean copy for a Korean locale", async () => {
		fake.busy = ["tui:x"];
		const outcome = await run(request({ locale: "ko_KR.UTF-8" }));
		expect(outcome.text).toBe("아직 작업 중인 대화가 있어요 (tui:x). 아무것도 바꾸지 않았어요. 끝난 뒤 /setup을 다시 실행하세요.");
	});

	test("concurrent applies run one after another", async () => {
		const [first, second] = await Promise.all([run(), run()]);
		expect(first.status).toBe("applied");
		// The second one was derived from the old base, so it must not overwrite the first.
		expect(second.status).toBe("conflict");
		expect(disk()).toBe(CANDIDATE);
	});
});

describe("setupRecover", () => {
	const journal = (pid = 4000) => writeFileSync(journalPath(fake.manifestPath), JSON.stringify({ baseSha256: sha256Hex(BASE), candidateSha256: sha256Hex(CANDIDATE), pid, startedAt: new Date().toISOString() }));

	test("no journal: nothing to do", async () => {
		expect(await setupRecover(manifest, server.port!, "en")).toEqual({ recovered: false });
	});

	test("interrupted before the restart: the base comes back from .bak", async () => {
		writeFileSync(`${manifest}.bak`, BASE);
		writeFileSync(manifest, CANDIDATE);
		journal();
		expect(await setupRecover(manifest, server.port!, "en")).toEqual({ recovered: true, message: "An earlier setup was interrupted; dinobot.yaml was brought back in line with the running daemon." });
		expect(disk()).toBe(BASE);
		expect(existsSync(journalPath(fake.manifestPath))).toBe(false);
	});

	test("the daemon already runs the candidate: the apply completed", async () => {
		writeFileSync(manifest, CANDIDATE);
		fake.sha = sha256Hex(CANDIDATE);
		journal();
		expect(await setupRecover(manifest, server.port!, "ko")).toEqual({ recovered: false });
		expect(disk()).toBe(CANDIDATE);
		expect(existsSync(journalPath(fake.manifestPath))).toBe(false);
	});

	test("a .bak that does not hold the base is reported, not applied", async () => {
		writeFileSync(`${manifest}.bak`, "unrelated: true\n");
		writeFileSync(manifest, CANDIDATE);
		journal();
		const result = await setupRecover(manifest, server.port!, "en");
		expect(result.recovered).toBe(false);
		expect(result.message).toContain("does not hold the settings from before the interrupted setup");
		expect(disk()).toBe(CANDIDATE);
	});
});
