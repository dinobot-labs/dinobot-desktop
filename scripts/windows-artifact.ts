import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const REPO = "dinobot-labs/dinobot";
export type Run = { id: number; head_sha: string; status: string; conclusion: string; path: string; event: string; repository: { full_name: string } };
export function bindSource(run: Run, tagSha: string, runId: string): void {
 if (!/^[1-9][0-9]*$/.test(runId) || String(run.id) !== runId || !/^[a-f0-9]{40}$/.test(tagSha) || run.head_sha !== tagSha
  || run.repository.full_name !== REPO || run.path !== ".github/workflows/release.yml"
  || !["push", "workflow_dispatch"].includes(run.event) || run.status !== "completed" || run.conclusion !== "success")
  throw new Error("Core release run must be successful and bound to the official tag source");
}
export function bindTarball(bytes: Uint8Array, sums: string, version: string, integrity: string): string {
 if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) throw new Error("Stable daemon version required");
 const sha512 = createHash("sha512").update(bytes).digest();
 const expected = sha512.toString("hex") + "  dinobot-" + version + ".tgz";
 if (sums.trim() !== expected || integrity !== "sha512-" + sha512.toString("base64")) throw new Error("CI and npm tarball digests must match exactly");
 return createHash("sha256").update(bytes).digest("hex");
}
const gh = (...args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
if (import.meta.main) {
 const root = resolve(import.meta.dir, "..");
 const pkg = JSON.parse(readFileSync(resolve(root, "apps/desktop/package.json"), "utf8"));
 const version: string = pkg.dinobotDaemon.dinobot;
 const runId = process.env.CORE_RUN_ID ?? "";
 if (!/^[1-9][0-9]*$/.test(runId)) throw new Error("CORE_RUN_ID must identify the successful official release workflow");
 const tag = "v" + version;
 const tagSha = gh("api", "repos/" + REPO + "/commits/" + tag, "--jq", ".sha");
 const run = JSON.parse(gh("api", "repos/" + REPO + "/actions/runs/" + runId)) as Run;
 bindSource(run, tagSha, runId);
 const out = resolve(root, "core-artifact");
 mkdirSync(out, { recursive: true });
 gh("run", "download", runId, "--repo", REPO, "--name", "npm-" + tagSha, "--dir", out);
 const response = await fetch("https://registry.npmjs.org/dinobot/" + version);
 if (!response.ok) throw new Error("Official npm version is not available: " + response.status);
 const registry = await response.json() as { name: string; version: string; dist: { integrity: string } };
 if (registry.name !== "dinobot" || registry.version !== version) throw new Error("Registry identity mismatch");
 const tarball = resolve(out, "dinobot-" + version + ".tgz");
 const sha256 = bindTarball(readFileSync(tarball), readFileSync(resolve(out, "SHA512SUMS"), "utf8"), version, registry.dist.integrity);
 writeFileSync(resolve(out, "lineage.json"), JSON.stringify({ repository: REPO, sourceSha: tagSha, runId, tag, version, sha256, integrity: registry.dist.integrity }, null, 2) + "\n");
 console.log("Verified official core " + version + " source=" + tagSha + " sha256=" + sha256);
}
