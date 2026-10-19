import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDesktopUpdate, checkDesktopUpdate, installBase } from "../src/features/desktop-update.ts";

const BASE = "https://updates.example.test/i/" + "a".repeat(43);

function home(state?: unknown): NodeJS.ProcessEnv {
	const dir = mkdtempSync(join(tmpdir(), "dinobot-desktop-update-"));
	if (state !== undefined) writeFileSync(join(dir, "install.json"), typeof state === "string" ? state : JSON.stringify(state));
	return { DINOBOT_DESKTOP_HOME: dir };
}

const serving = (version: unknown, status = 200) => {
	const urls: string[] = [];
	const fetcher = (async (url: string) => {
		urls.push(String(url));
		return new Response(JSON.stringify({ schema: 1, version }), { status });
	}) as unknown as typeof fetch;
	return { urls, fetcher };
};

describe("desktop self-update", () => {
	test("reads the invite base the installer saved; rejects anything else", () => {
		expect(installBase(home({ base: BASE }))).toBe(BASE);
		expect(installBase(home())).toBeNull();
		expect(installBase(home("{not json"))).toBeNull();
		expect(installBase(home({ base: "https://evil.example/elsewhere" }))).toBeNull();
		expect(installBase(home({ base: "http://updates.example.test/i/" + "a".repeat(43) }))).toBeNull();
		expect(installBase(home({ base: BASE + "'; rm -rf ~" }))).toBeNull();
	});

	test("compares the running version with latest.json of the invite", async () => {
		const { urls, fetcher } = serving("0.2.0");
		expect(await checkDesktopUpdate("0.1.0", { env: home({ base: BASE }), fetch: fetcher })).toEqual({ current: "0.1.0", latest: "0.2.0", newer: true });
		expect(urls).toEqual([`${BASE}/latest.json`]);
		expect(await checkDesktopUpdate("0.2.0", { env: home({ base: BASE }), fetch: serving("0.2.0").fetcher })).toEqual({ current: "0.2.0", latest: "0.2.0", newer: false });
	});

	test("silent (null) without an install, when disabled, offline, revoked or malformed", async () => {
		const ok = serving("0.2.0").fetcher;
		expect(await checkDesktopUpdate("0.1.0", { env: home(), fetch: ok })).toBeNull();
		expect(await checkDesktopUpdate("0.1.0", { env: { ...home({ base: BASE }), DINOBOT_NO_UPDATE_CHECK: "1" }, fetch: ok })).toBeNull();
		expect(await checkDesktopUpdate("0.1.0", { env: home({ base: BASE }), fetch: serving("0.2.0", 404).fetcher })).toBeNull();
		expect(await checkDesktopUpdate("0.1.0", { env: home({ base: BASE }), fetch: serving("latest").fetcher })).toBeNull();
		const failing = (async () => {
			throw new Error("offline");
		}) as unknown as typeof fetch;
		expect(await checkDesktopUpdate("0.1.0", { env: home({ base: BASE }), fetch: failing })).toBeNull();
	});

	test("apply does nothing without an installer-made install", () => {
		expect(applyDesktopUpdate({ env: home() })).toBe(false);
	});
});
