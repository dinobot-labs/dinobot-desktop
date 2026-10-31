import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { bindJobs, selectArtifact, bindArtifact, bindSourceFiles, type Job, type Artifact } from "./core-source.ts";
import { execFileSync } from "node:child_process";

const REPO = "dinobot-labs/dinobot";
export type Run = { id: number; head_sha: string; status: string; conclusion: string; path: string; event: string; repository: { full_name: string } };
export type SourceMode = "npm" | "github";
export function sourceMode(value = "npm"): SourceMode {
 if (value !== "npm" && value !== "github") throw new Error("CORE_SOURCE_MODE must be npm or github");
 return value;
}
export function bindSource(run: Run, tagSha: string, runId: string, mode: SourceMode = "npm", jobs: Job[] = []): void {
 if (!/^[1-9][0-9]*$/.test(runId) || String(run.id) !== runId || !/^[a-f0-9]{40}$/.test(tagSha) || run.head_sha !== tagSha
  || run.repository.full_name !== REPO || run.path !== ".github/workflows/release.yml"
  || !["push", "workflow_dispatch"].includes(run.event) || run.status !== "completed" || (run.conclusion !== "success" && !(mode === "github" && run.conclusion === "failure")))
  throw new Error("Core release run must be bound to the official tag source");
 if (mode === "github") bindJobs(run, jobs);
}
export function bindTarball(bytes: Uint8Array, sums: string, version: string, integrity: string): string {
 if (integrity !== "sha512-" + createHash("sha512").update(bytes).digest("base64")) throw new Error("npm integrity mismatch");
 return bindCiTarball(bytes, sums, version);
}
export function bindCiTarball(bytes: Uint8Array, sums: string, version: string): string {
 if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) throw new Error("Stable daemon version required");
 const sha512 = createHash("sha512").update(bytes).digest();
 const expected = sha512.toString("hex") + "  dinobot-" + version + ".tgz";
 if (sums.trim() !== expected) throw new Error("CI and npm tarball digests must match exactly");
 return createHash("sha256").update(bytes).digest("hex");
}
const gh = (...args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
if (import.meta.main) {
 const root = resolve(import.meta.dir, "..");
 const pkg = JSON.parse(readFileSync(resolve(root, "apps/desktop/package.json"), "utf8"));
 const version: string = pkg.dinobotDaemon.dinobot;
 const mode = sourceMode(process.env.CORE_SOURCE_MODE);
 const runId = process.env.CORE_RUN_ID ?? "";
 if (!/^[1-9][0-9]*$/.test(runId)) throw new Error("CORE_RUN_ID must identify the successful official release workflow");
 const tag = "v" + version;
 const tagSha = gh("api", "repos/" + REPO + "/commits/" + tag, "--jq", ".sha");
 const run = JSON.parse(gh("api", "repos/" + REPO + "/actions/runs/" + runId)) as Run;
 const jobs = mode === "github" ? JSON.parse(gh("api", "repos/" + REPO + "/actions/runs/" + runId + "/jobs?per_page=100", "--paginate", "--slurp")).flatMap((p: { jobs: Job[] }) => p.jobs) as Job[] : [];
 bindSource(run, tagSha, runId, mode, jobs);
 const out = resolve(root, "core-artifact");
 mkdirSync(out, { recursive: true });
 if (mode === "github") {
  verifyGithubArtifact(run, jobs, version, tag, out);
 } else {
 gh("run", "download", runId, "--repo", REPO, "--name", "npm-" + tagSha, "--dir", out);
 const response = await fetch("https://registry.npmjs.org/dinobot/" + version);
 if (!response.ok) throw new Error("Official npm version is not available: " + response.status);
 const registry = await response.json() as { name: string; version: string; dist: { integrity: string } };
 if (registry.name !== "dinobot" || registry.version !== version) throw new Error("Registry identity mismatch");
 const tarball = resolve(out, "dinobot-" + version + ".tgz");
 const sha256 = bindTarball(readFileSync(tarball), readFileSync(resolve(out, "SHA512SUMS"), "utf8"), version, registry.dist.integrity);
 writeFileSync(resolve(out, "lineage.json"), JSON.stringify({ sourceMode: mode, npm: { status: "verified", used: true }, repository: REPO, sourceSha: tagSha, runId, tag, version, sha256, integrity: registry.dist.integrity }, null, 2) + "\n");
 console.log("Verified official core " + version + " source=" + tagSha + " sha256=" + sha256);
 }
}

function verifyGithubArtifact(run: Run, jobs: Job[], version: string, tag: string, out: string): void {
 const pages = JSON.parse(gh("api", "repos/" + REPO + "/actions/runs/" + run.id + "/artifacts?per_page=100", "--paginate", "--slurp")) as { artifacts: Artifact[] }[];
 const artifact = selectArtifact(pages.flatMap(p => p.artifacts), run);
 const zip = execFileSync("gh", ["api", "repos/" + REPO + "/actions/artifacts/" + artifact.id + "/zip"], { maxBuffer: 64 * 1024 * 1024 });
 bindArtifact(zip, artifact);
 const zipPath = resolve(out, "artifact-" + artifact.id + ".zip");
 writeFileSync(zipPath, zip);
 const win = process.platform === "win32";
 const unzip = win ? resolve(process.env.SystemRoot ?? "C:/Windows", "System32/tar.exe") : "unzip";
 const members = execFileSync(unzip, win ? ["-tf", zipPath] : ["-Z1", zipPath], { encoding: "utf8" }).trim().split(/\r?\n/).sort();
 if (JSON.stringify(members) !== JSON.stringify(["SHA512SUMS", "dinobot-" + version + ".tgz"].sort())) throw new Error("Unexpected CI artifact members");
 // Read members to memory, never extract paths or links from the ZIP.
 const member = (name: string) => execFileSync(unzip, win ? ["-xOf", zipPath, name] : ["-p", zipPath, name], { maxBuffer: 64 * 1024 * 1024 });
 const bytes = member("dinobot-" + version + ".tgz");
 const sums = member("SHA512SUMS").toString("utf8");
 const sha256 = bindCiTarball(bytes, sums, version);
 const sourceFile = (name: string) => Buffer.from(gh("api", "repos/" + REPO + "/contents/" + name + "?ref=" + run.head_sha, "--jq", ".content"), "base64");
 const manifest = sourceFile("SOURCE_SHA256SUMS");
 const files = { "package.json": sourceFile("package.json"), "script/release-audit.ts": sourceFile("script/release-audit.ts") };
 bindSourceFiles(manifest.toString("utf8"), files, version);
 const tarball = resolve(out, "dinobot-" + version + ".tgz");
 const auditor = resolve(out, "release-audit.ts");
 writeFileSync(tarball, bytes);
 writeFileSync(resolve(out, "SHA512SUMS"), sums);
 writeFileSync(resolve(out, "SOURCE_SHA256SUMS"), manifest);
 writeFileSync(auditor, files["script/release-audit.ts"]);
 // Reuse the exact source-owned strict six-member archive audit; do not weaken it for GitHub mode.
 const gnuTar = "C:/Program Files/Git/usr/bin";
 const env = { ...process.env, PATH: win && existsSync(resolve(gnuTar, "tar.exe")) ? gnuTar + delimiter + process.env.PATH : process.env.PATH };
 execFileSync(process.execPath, [auditor, tarball, version, "dinobot"], { env, stdio: "inherit" });
 const lineage = { sourceMode: "github", npm: { status: "unverified", used: false }, repository: REPO, sourceSha: run.head_sha, runId: String(run.id), tag, version, sha256, artifact: { id: artifact.id, digest: artifact.digest }, sourceManifestSha256: createHash("sha256").update(manifest).digest("hex"), sourceManifestVerifiedFiles: Object.keys(files), checks: jobs.map(j => ({ id: j.id, name: j.name, conclusion: j.conclusion })), releaseConclusion: run.conclusion };
 writeFileSync(resolve(out, "lineage.json"), JSON.stringify(lineage, null, 2) + "\n");
 console.log("Verified GitHub core " + version + " source=" + run.head_sha + " sha256=" + sha256 + "; npm unverified/not used");
}
