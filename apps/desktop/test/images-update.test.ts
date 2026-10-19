import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readImageFile } from "../src/features/images.ts";
import { checkUpdate, isNewerStableVersion, REGISTRY_URL, UPDATE_CACHE_TTL_MS } from "../src/features/update.ts";

let dir: string;
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "dinobot-img-"));
	writeFileSync(join(dir, "a.png"), PNG);
	writeFileSync(join(dir, "fake.png"), "not an image");
	writeFileSync(join(dir, "a.bmp"), PNG);
	writeFileSync(join(dir, "big.jpg"), Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(2 * 1024 * 1024)]));
	writeFileSync(join(dir, "photo.jpeg"), Buffer.from([255, 216, 255, 224, 0, 16]));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("readImageFile", () => {
	test("reads a png by magic bytes", async () => {
		const result = await readImageFile(join(dir, "a.png"));
		expect(result).toEqual({ mimeType: "image/png", data: PNG.toString("base64"), bytes: PNG.byteLength });
	});

	test("accepts quoted paths and file:// URLs", async () => {
		expect(await readImageFile(`"${join(dir, "photo.jpeg")}"`)).toMatchObject({ mimeType: "image/jpeg", bytes: 6 });
		expect(await readImageFile(pathToFileURL(join(dir, "a.png")).href)).toMatchObject({ mimeType: "image/png" });
	});

	test("the TUI's error for unreadable or unsupported files", async () => {
		for (const name of ["fake.png", "a.bmp", "missing.png"]) {
			const path = join(dir, name);
			expect(await readImageFile(path)).toEqual({ error: `${path} is not a readable png/jpeg/gif/webp image` });
		}
	});

	test("the per-image limit", async () => {
		expect(await readImageFile(join(dir, "big.jpg"))).toEqual({ error: "image is 2.0 MiB; the per-image limit is 2.0 MiB" });
	});
});

describe("checkUpdate", () => {
	const registry = (version: string, name = "dinobot") => {
		const calls: string[] = [];
		const fetcher = (async (url: string | URL | Request) => {
			calls.push(String(url));
			return new Response(JSON.stringify({ name, version }), { status: 200, headers: { "content-type": "application/json" } });
		}) as unknown as typeof fetch;
		return { calls, fetcher };
	};

	test("newer stable version from the registry, cached for 6 hours", async () => {
		const cachePath = join(dir, "update-1.json");
		const { calls, fetcher } = registry("0.8.0");
		let now = 1_000_000;
		const options = { cachePath, fetch: fetcher, now: () => now, env: {} };
		expect(await checkUpdate("0.7.13", options)).toEqual({ latest: "0.8.0", newer: true });
		expect(calls).toEqual([REGISTRY_URL]);
		expect(JSON.parse(readFileSync(cachePath, "utf8"))).toEqual({ schemaVersion: 1, latest: "0.8.0", checkedAt: 1_000_000 });
		now += UPDATE_CACHE_TTL_MS - 1;
		expect(await checkUpdate("0.8.0", options)).toEqual({ latest: "0.8.0", newer: false });
		expect(calls.length).toBe(1);
		now += 1;
		await checkUpdate("0.8.0", options);
		expect(calls.length).toBe(2);
	});

	test("disabled by DINOBOT_NO_UPDATE_CHECK=1", async () => {
		const { calls, fetcher } = registry("9.9.9");
		expect(await checkUpdate("0.1.0", { cachePath: join(dir, "update-2.json"), fetch: fetcher, env: { DINOBOT_NO_UPDATE_CHECK: "1" } })).toBeNull();
		expect(calls.length).toBe(0);
	});

	test("silent on failures and bad metadata", async () => {
		const failing = (async () => {
			throw new Error("offline");
		}) as unknown as typeof fetch;
		expect(await checkUpdate("0.1.0", { cachePath: join(dir, "update-3.json"), fetch: failing, env: {} })).toBeNull();
		const http500 = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
		expect(await checkUpdate("0.1.0", { cachePath: join(dir, "update-4.json"), fetch: http500, env: {} })).toBeNull();
		expect(await checkUpdate("0.1.0", { cachePath: join(dir, "update-5.json"), fetch: registry("1.0.0", "other").fetcher, env: {} })).toBeNull();
		expect(await checkUpdate("0.1.0", { cachePath: join(dir, "update-6.json"), fetch: registry("1.0.0-beta.1").fetcher, env: {} })).toBeNull();
		expect(await checkUpdate("not-a-version", { cachePath: join(dir, "update-7.json"), fetch: registry("1.0.0").fetcher, env: {} })).toBeNull();
	});

	test("semver precedence", () => {
		expect(isNewerStableVersion("0.7.13", "0.7.14")).toBe(true);
		expect(isNewerStableVersion("0.9.0", "0.10.0")).toBe(true);
		expect(isNewerStableVersion("1.0.0-rc.1", "1.0.0")).toBe(true);
		expect(isNewerStableVersion("1.0.0", "1.0.0")).toBe(false);
		expect(isNewerStableVersion("1.2.0", "1.1.9")).toBe(false);
	});
});
