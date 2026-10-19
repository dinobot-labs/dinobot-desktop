import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import type { DaemonConfig } from "../src/bridge-types.ts";
import { bindable, daemonInfo, defaultManifest, DEFAULT_ENSURE_LIMITS, type EnsurePorts, ensureDaemonWith, listening, setManifestPort, withPort } from "../src/daemon-ensure.ts";

const dir = mkdtempSync(join(tmpdir(), "dinobot-ensure-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const MANIFEST = "/home/u/.config/dinobot/dinobot.yaml";
type Occupant = { kind: "dinobot"; manifest: string; pid: number } | { kind: "program" } | { kind: "reserved" } | { kind: "booting"; manifest: string; pid: number; at: number };

/**
 * A simulated machine: who holds which loopback port, the manifest's api.port, a clock, and a daemon that binds
 * api.port `bootMs` after it is spawned (or exits with the daemon's real messages when it cannot).
 */
function world(init: { port?: number | null; manifest?: boolean; occupants?: Record<number, Occupant>; bootMs?: number; onSpawn?: (w: { spawned: number[]; occupants: Map<number, Occupant> }) => void; failBoot?: string; conflicts?: number }) {
	const w = {
		clock: 0,
		manifestExists: init.manifest ?? true,
		port: init.port === undefined ? 8786 : init.port,
		occupants: new Map<number, Occupant>(Object.entries(init.occupants ?? {}).map(([k, v]) => [Number(k), v])),
		spawned: [] as number[],
		log: "",
		setPortCalls: 0,
		conflicts: init.conflicts ?? 0,
		children: [] as { pid: number; port: number; at: number; exited: boolean }[],
	};
	const tick = () => {
		for (const child of w.children) {
			if (child.exited || w.clock < child.at) continue;
			const holder = w.occupants.get(child.port);
			const lockHeld = [...w.occupants.values()].some((o) => (o.kind === "dinobot" || o.kind === "booting") && o.manifest === MANIFEST && o.pid !== child.pid);
			if (lockHeld) {
				child.exited = true;
				w.log += "dinobot: another dinobot daemon is already running for /home/u/.local/share/dinobot\n";
			} else if (init.failBoot) {
				child.exited = true;
				w.log += `${init.failBoot}\n`;
			} else if (holder && !(holder.kind === "booting" && holder.pid === child.pid)) {
				child.exited = true;
				w.log += `error: Failed to start server. Is port ${child.port} in use?\n`;
			} else w.occupants.set(child.port, { kind: "dinobot", manifest: MANIFEST, pid: child.pid });
		}
		for (const [port, o] of w.occupants) if (o.kind === "booting" && w.clock >= o.at && !w.children.some((c) => c.pid === o.pid)) w.occupants.set(port, { kind: "dinobot", manifest: o.manifest, pid: o.pid });
	};
	const config = (): DaemonConfig => ({
		manifestPath: w.manifestExists ? MANIFEST : null,
		port: w.port ?? 8786,
		dataDir: "/home/u/.local/share/dinobot",
		workspaceRoot: null,
		homeDir: "/home/u",
		command: "/app/resources/daemon/node_modules/dinobot/main.js",
		bundled: true,
	});
	const ports: EnsurePorts = {
		config: async () => config(),
		createDefaultManifest: async () => {
			w.manifestExists = true;
			w.port = 8786;
		},
		manifestPort: async () => w.port,
		setPort: async (_path, port) => {
			w.setPortCalls++;
			if (w.conflicts > 0) {
				w.conflicts--;
				return false;
			}
			w.port = port;
			return true;
		},
		info: async (port) => {
			tick();
			const o = w.occupants.get(port);
			return o?.kind === "dinobot" ? { manifestPath: o.manifest, pid: o.pid } : null;
		},
		listening: async (port) => {
			const o = w.occupants.get(port);
			return o !== undefined && o.kind !== "reserved";
		},
		bindable: async (port) => !w.occupants.has(port),
		realpath: async (path) => path,
		spawn: async (cfg) => {
			const pid = 1000 + w.children.length;
			const child = { pid, port: cfg.port, at: w.clock + (init.bootMs ?? 300), exited: false };
			w.children.push(child);
			w.spawned.push(cfg.port);
			init.onSpawn?.(w);
			return { pid, exited: () => (tick(), child.exited) };
		},
		logTail: async () => w.log.trim(),
		sleep: async (ms) => {
			w.clock += ms;
			tick();
		},
		now: () => w.clock,
	};
	return { w, ports };
}

const limits = { ...DEFAULT_ENSURE_LIMITS, pollMs: 100 };

describe("ensureDaemonWith", () => {
	test("nothing running: starts the daemon on api.port and waits until it is ours", async () => {
		const { w, ports } = world({});
		const result = await ensureDaemonWith(ports, limits);
		expect(result).toEqual({ ok: true, pid: 1000, port: 8786 });
		expect(w.spawned).toEqual([8786]);
		expect(w.setPortCalls).toBe(0);
	});

	test("our daemon already answers: reused, nothing spawned", async () => {
		const { w, ports } = world({ occupants: { 8786: { kind: "dinobot", manifest: MANIFEST, pid: 7 } } });
		expect(await ensureDaemonWith(ports, limits)).toEqual({ ok: true, pid: 7, port: 8786 });
		expect(w.spawned).toEqual([]);
	});

	test("another program holds the port: api.port moves to the next free port and the daemon starts there", async () => {
		const { w, ports } = world({ occupants: { 8786: { kind: "program" } } });
		const result = await ensureDaemonWith(ports, limits);
		expect(result).toEqual({ ok: true, pid: 1000, port: 8787, movedFrom: 8786 });
		expect(w.port).toBe(8787);
		expect(w.spawned).toEqual([8787]);
		expect(w.occupants.get(8786)).toEqual({ kind: "program" }); // untouched
	});

	test("a dinobot daemon of a different manifest is foreign too", async () => {
		const { w, ports } = world({ occupants: { 8786: { kind: "dinobot", manifest: "/other/dinobot.yaml", pid: 5 }, 8787: { kind: "program" } } });
		const result = await ensureDaemonWith(ports, limits);
		expect(result).toMatchObject({ ok: true, port: 8788, movedFrom: 8786 });
		expect(w.spawned).toEqual([8788]);
	});

	test("a port the OS refuses to bind (reserved range) is skipped", async () => {
		const { w, ports } = world({ occupants: { 8786: { kind: "reserved" } } });
		expect(await ensureDaemonWith(ports, limits)).toMatchObject({ ok: true, port: 8787, movedFrom: 8786 });
		expect(w.spawned).toEqual([8787]);
	});

	test("taken between the check and the bind: the daemon exits with 'in use' and the next port is used", async () => {
		const { w, ports } = world({
			onSpawn: (world) => {
				if (world.spawned.length === 1) world.occupants.set(8786, { kind: "program" });
			},
		});
		const result = await ensureDaemonWith(ports, limits);
		expect(result).toMatchObject({ ok: true, port: 8787, movedFrom: 8786 });
		expect(w.spawned).toEqual([8786, 8787]);
	});

	test("the TUI is starting our daemon at the same time: ours loses the lock, theirs is used", async () => {
		const { w, ports } = world({
			bootMs: 200,
			onSpawn: (world) => {
				world.occupants.set(9999, { kind: "booting", manifest: MANIFEST, pid: 42, at: 0 });
			},
		});
		// The TUI's daemon binds api.port a little later than ours would have.
		const realSleep = ports.sleep;
		ports.sleep = async (ms) => {
			await realSleep(ms);
			if (w.clock >= 600 && !w.occupants.has(8786)) {
				w.occupants.delete(9999);
				w.occupants.set(8786, { kind: "dinobot", manifest: MANIFEST, pid: 42 });
			}
		};
		const result = await ensureDaemonWith(ports, limits);
		expect(result).toEqual({ ok: true, port: 8786 });
		expect(w.setPortCalls).toBe(0);
	});

	test("a daemon that fails to boot is reported with its log; the manifest is not touched", async () => {
		const { w, ports } = world({ failBoot: "Daemon startup failed: bad manifest" });
		const result = await ensureDaemonWith(ports, limits);
		expect(result.ok).toBe(false);
		expect(result.logTail).toContain("bad manifest");
		expect(w.setPortCalls).toBe(0);
		expect(w.port).toBe(8786);
	});

	test("no manifest yet: the first-run manifest is created and the daemon started", async () => {
		const { w, ports } = world({ manifest: false });
		expect(await ensureDaemonWith(ports, limits)).toMatchObject({ ok: true, port: 8786 });
		expect(w.manifestExists).toBe(true);
	});

	test("a manifest without an api section gets one", async () => {
		const { w, ports } = world({ port: null });
		expect(await ensureDaemonWith(ports, limits)).toMatchObject({ ok: true, port: 8786 });
		expect(w.port).toBe(8786);
		expect(w.setPortCalls).toBe(1);
	});

	test("a concurrent manifest edit makes the port swap retry from the new text", async () => {
		const { w, ports } = world({ occupants: { 8786: { kind: "program" } }, conflicts: 1 });
		expect(await ensureDaemonWith(ports, limits)).toMatchObject({ ok: true, port: 8787 });
		expect(w.setPortCalls).toBe(2);
	});

	test("something that accepts connections but never answers as dinobot is foreign after the grace period", async () => {
		const { w, ports } = world({ occupants: { 8786: { kind: "program" } } });
		const start = w.clock;
		await ensureDaemonWith(ports, limits);
		expect(w.clock - start).toBeGreaterThanOrEqual(limits.graceMs);
	});
});

describe("manifest edit", () => {
	test("withPort changes only api.port and keeps comments", () => {
		const text = defaultManifest("/home/u");
		const out = withPort(text, 8790);
		expect(parse(out).api.port).toBe(8790);
		expect(out).toContain("# loopback client API for `dinobot tui`");
		expect(out).toContain("# Created by the first dinobot run.");
		expect(out.replace("8790", "8786")).toBe(text);
	});

	test("withPort adds a missing api section", () => {
		const out = withPort("bot:\n  dataDir: /x\n", 8786);
		expect(parse(out)).toEqual({ bot: { dataDir: "/x" }, api: { port: 8786 } });
	});

	test("setManifestPort rewrites the file on disk", async () => {
		const path = join(dir, "dinobot.yaml");
		writeFileSync(path, defaultManifest("/home/u"));
		expect(await setManifestPort(path, 8801)).toBe(true);
		expect(parse(readFileSync(path, "utf8")).api.port).toBe(8801);
	});
});

describe("real probes", () => {
	const servers: Server[] = [];
	afterAll(() => {
		for (const s of servers) s.close();
	});
	const listen = (port = 0) =>
		new Promise<number>((resolve) => {
			const server = createServer((socket) => socket.end());
			servers.push(server);
			server.listen({ host: "127.0.0.1", port }, () => resolve((server.address() as { port: number }).port));
		});

	test("a held port is listening and not bindable; a released one is bindable", async () => {
		const port = await listen();
		expect(await listening(port)).toBe(true);
		expect(await bindable(port)).toBe(false);
		servers.pop()?.close();
		await new Promise((r) => setTimeout(r, 50));
		expect(await bindable(port)).toBe(true);
		expect(await listening(port)).toBe(false);
	});

	test("daemonInfo: a dinobot answer, an old dinobot, and an unrelated HTTP server", async () => {
		const routes = (handler: (path: string) => Response) => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => handler(new URL(r.url).pathname) });
		const dinobot = routes((p) => (p === "/v1/daemon" ? Response.json({ pid: 9, manifestPath: "/m.yaml", version: "0.7.13" }) : new Response("ok")));
		const old = routes((p) => (p === "/healthz" ? new Response("ok") : new Response("not found", { status: 404 })));
		const other = routes((p) => (p === "/healthz" ? new Response("healthy") : new Response("<html>", { status: 404 })));
		try {
			expect(await daemonInfo(dinobot.port as number)).toEqual({ manifestPath: "/m.yaml", pid: 9 });
			expect(await daemonInfo(old.port as number)).toBe("legacy");
			expect(await daemonInfo(other.port as number)).toBeNull();
		} finally {
			dinobot.stop(true);
			old.stop(true);
			other.stop(true);
		}
	});
});

describe("bundled runtime", () => {
	test("the bundled daemon is preferred over PATH and runs as bun + main.js", async () => {
		const { bundledDaemonAt, daemonLaunch, dinobotCommand, setBundledDaemonDir } = await import("../src/daemon.ts");
		const bundle = join(dir, "bundle");
		mkdirSync(join(bundle, "node_modules", "dinobot"), { recursive: true });
		writeFileSync(join(bundle, "node_modules", "dinobot", "main.js"), "");
		writeFileSync(join(bundle, process.platform === "win32" ? "bun.exe" : "bun"), "");
		expect(bundledDaemonAt(bundle)).toBeNull(); // no daemon.json: incomplete
		writeFileSync(join(bundle, "daemon.json"), JSON.stringify({ dinobot: "0.7.13", bun: "1.4.3", os: "win", arch: "x64" }));
		expect(bundledDaemonAt(bundle)?.runtime).toBe("0.7.13-bun1.4.3-x64");
		const saved = process.env.DINOBOT_BIN;
		delete process.env.DINOBOT_BIN;
		const savedLocal = process.env.LOCALAPPDATA;
		process.env.LOCALAPPDATA = join(dir, "local");
		try {
			setBundledDaemonDir(bundle);
			const command = await dinobotCommand();
			expect(command).toBe(join(bundle, "node_modules", "dinobot", "main.js"));
			const launch = await daemonLaunch(command as string);
			const root = process.platform === "win32" ? join(dir, "local", "dinobot-desktop", "daemon", "0.7.13-bun1.4.3-x64") : bundle;
			expect(launch).toEqual({ file: join(root, process.platform === "win32" ? "bun.exe" : "bun"), prefix: [join(root, "node_modules", "dinobot", "main.js")] });
		} finally {
			setBundledDaemonDir(null);
			if (saved !== undefined) process.env.DINOBOT_BIN = saved;
			if (savedLocal !== undefined) process.env.LOCALAPPDATA = savedLocal;
			else delete process.env.LOCALAPPDATA;
		}
	});

	test("installRuntimeCopy copies once and removes older runtimes that are not in use", async () => {
		const { bundledDaemonAt, installRuntimeCopy } = await import("../src/daemon.ts");
		const bundle = join(dir, "bundle2");
		mkdirSync(join(bundle, "node_modules", "dinobot"), { recursive: true });
		writeFileSync(join(bundle, "node_modules", "dinobot", "main.js"), "// v2");
		writeFileSync(join(bundle, process.platform === "win32" ? "bun.exe" : "bun"), "");
		writeFileSync(join(bundle, "daemon.json"), JSON.stringify({ dinobot: "0.8.0", bun: "1.4.3", arch: "x64" }));
		const base = join(dir, "runtimes");
		mkdirSync(join(base, "0.7.13-bun1.4.3-x64"), { recursive: true });
		writeFileSync(join(base, "0.7.13-bun1.4.3-x64", "daemon.json"), "{}");
		const bundled = bundledDaemonAt(bundle)!;
		const target = await installRuntimeCopy(bundled, base);
		expect(target).toBe(join(base, "0.8.0-bun1.4.3-x64"));
		expect(readFileSync(join(target, "node_modules", "dinobot", "main.js"), "utf8")).toBe("// v2");
		expect(bundledDaemonAt(join(base, "0.7.13-bun1.4.3-x64"))).toBeNull();
		const { readdirSync } = await import("node:fs");
		expect(readdirSync(base)).toEqual(["0.8.0-bun1.4.3-x64"]);
		expect(await installRuntimeCopy(bundled, base)).toBe(target); // second call: already there
	});
});
