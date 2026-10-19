import { describe, expect, test } from "bun:test";
import type { BrowserReply, BrowserViewState } from "../../../desktop/src/browser-types.ts";
import { BrowserClient, importChromeProfile } from "../../src/panel/browser-client.ts";

const view = (control: "agent" | "user" = "agent"): BrowserViewState => ({ connected: true, mode: "dedicated", control, tabs: [], current: 0, url: "about:blank", title: "", width: 1200, height: 800 });

describe("single in-flight UI browser queue", () => {
	test("serializes transport and keeps a transaction contiguous", async () => {
		const calls: string[] = [];
		let resolve!: () => void;
		const gate = new Promise<void>((done) => { resolve = done; });
		let active = 0, max = 0;
		const client = new BrowserClient(async (action) => {
			active++; max = Math.max(active, max); calls.push(action);
			if (action === "takeover") await gate;
			active--; return { ok: true };
		});
		const first = client.transaction(async (call) => { await call("takeover"); await call("import"); await call("resume"); });
		const second = client.request("frame");
		await Promise.resolve();
		expect(calls).toEqual(["takeover"]);
		expect(client.pending).toBe(2);
		resolve(); await Promise.all([first, second]);
		expect(calls).toEqual(["takeover", "import", "resume", "frame"]);
		expect(max).toBe(1); expect(client.pending).toBe(0);
	});
	test("failure is visible but does not poison the queue", async () => {
		const client = new BrowserClient(async (action) => action === "open" ? { ok: false, error: "denied" } : { ok: true });
		await expect(client.request("open")).rejects.toThrow("denied");
		expect((await client.request("state")).ok).toBe(true); expect(client.pending).toBe(0);
	});
	test("queue is bounded, with no dropped request reported as success", async () => {
		let resolve!: () => void;
		const gate = new Promise<void>((done) => { resolve = done; });
		const client = new BrowserClient(async () => { await gate; return { ok: true }; });
		const requests = Array.from({ length: 64 }, () => client.request("input"));
		await expect(client.request("input")).rejects.toThrow();
		resolve(); await Promise.all(requests); expect(client.pending).toBe(0);
	});
});

function fixture(options: { control?: "agent" | "user"; count?: number; fail?: string; takeoverControl?: "agent" | "user"; missingState?: boolean } = {}) {
	const calls: { action: string; args?: Record<string, unknown> }[] = [];
	const client = new BrowserClient(async (action, args): Promise<BrowserReply> => {
		calls.push({ action, args });
		if (options.fail === action) return { ok: false, error: `failed ${action}` };
		if (action === "state") return { ok: true, ...(options.missingState ? {} : { state: view(options.control) }) };
		if (action === "takeover") return { ok: true, state: view(options.takeoverControl ?? "user") };
		if (action === "import") return { ok: true, imported: options.count ?? 3, skipped: 2 };
		return { ok: true };
	});
	return { client, calls, actions: () => calls.map((call) => call.action) };
}

describe("explicit Chrome import transaction", () => {
	test("no selected profile or consent means no IPC calls", async () => {
		const f = fixture();
		await expect(importChromeProfile(f.client, "Default", false)).rejects.toThrow();
		await expect(importChromeProfile(f.client, "", true)).rejects.toThrow();
		expect(f.calls).toEqual([]);
	});
	test("takes control before import, restores agent, exposes counts only", async () => {
		const f = fixture();
		const result = await importChromeProfile(f.client, "Profile 1", true);
		expect(f.actions()).toEqual(["state", "takeover", "import", "resume"]);
		expect(f.calls[2]?.args).toEqual({ profile: "Profile 1", confirmed: true });
		expect(result.imported).toBe(3); expect(result.skipped).toBe(2);
	});
	test("preserves existing user control", async () => {
		const f = fixture({ control: "user" });
		await importChromeProfile(f.client, "Default", true);
		expect(f.actions()).toEqual(["state", "takeover", "import"]);
	});
	test("failed import still resumes agent and never claims success", async () => {
		const f = fixture({ fail: "import" });
		await expect(importChromeProfile(f.client, "Default", true)).rejects.toThrow("failed import");
		expect(f.actions()).toEqual(["state", "takeover", "import", "resume"]);
	});
	test("zero imported cookies is an actionable failure, not success", async () => {
		const f = fixture({ count: 0 });
		await expect(importChromeProfile(f.client, "Default", true)).rejects.toThrow("가져온 쿠키가 없어요");
		expect(f.actions()).toEqual(["state", "takeover", "import", "resume"]);
	});
	test("missing state or failed takeover stops before cookie access", async () => {
		for (const option of [{ missingState: true }, { fail: "takeover" }, { takeoverControl: "agent" as const }]) {
			const f = fixture(option);
			await expect(importChromeProfile(f.client, "Default", true)).rejects.toThrow();
			expect(f.actions()).not.toContain("import");
		}
	});
	test("failed resume reports actual import count and manual handback action", async () => {
		const f = fixture({ fail: "resume" });
		await expect(importChromeProfile(f.client, "Default", true)).rejects.toThrow("가져온 쿠키 3개");
	});
	test("profile listing is passive, with no takeover, import or open", async () => {
		const f = fixture(); await f.client.request("profiles"); expect(f.actions()).toEqual(["profiles"]);
	});
});
