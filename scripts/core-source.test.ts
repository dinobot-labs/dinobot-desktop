import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { bindSource, bindCiTarball, sourceMode, type Run } from "./windows-artifact.ts";
import { SOURCE_JOBS, bindArtifact, selectArtifact, bindSourceFiles, type Job, type Artifact } from "./core-source.ts";
const sha = "a".repeat(40);
const run: Run = { id: 42, head_sha: sha, status: "completed", conclusion: "failure", path: ".github/workflows/release.yml", event: "push", repository: { full_name: "dinobot-labs/dinobot" } };
const jobs: Job[] = [...SOURCE_JOBS, "Release PR and tag"].map((name, id) => ({ id, name, run_id: 42, head_sha: sha, status: "completed", conclusion: "success", steps: [] }));
jobs.push({ id: 99, name: "Publish audited npm tarball", run_id: 42, head_sha: sha, status: "completed", conclusion: "failure", steps: ["Bind tag to the tested source", "Recheck exact downloaded bytes and payload", "Refuse conflicts, downgrades, and ambiguous registry failures"].map(name => ({ name, conclusion: "success" })).concat([{ name: "Publish through npm Trusted Publishing (no stored npm token)", conclusion: "failure" }]) });
const bind = (j = jobs, r = run) => bindSource(r, sha, "42", "github", j);
test("explicit GitHub mode accepts solely npm publish failure, default npm rejects it", () => {
 expect(() => bind()).not.toThrow();
 expect(() => bindSource(run, sha, "42")).toThrow();
 expect(sourceMode()).toBe("npm");
 expect(sourceMode("github")).toBe("github");
 for (const value of ["", "GitHub", "fallback"]) expect(() => sourceMode(value)).toThrow();
});
test("successful full source run also accepted", () => {
 const j = structuredClone(jobs); j.pop();
 expect(() => bind(j, { ...run, conclusion: "success" })).not.toThrow();
});
for (const name of SOURCE_JOBS) {
 for (const conclusion of ["failure", "skipped", "cancelled", "neutral"]) test(name + " rejects " + conclusion, () => {
  expect(() => bind(jobs.map(j => j.name === name ? { ...j, conclusion } : j))).toThrow();
 });
 test(name + " rejects missing or duplicated job", () => {
  expect(() => bind(jobs.filter(j => j.name !== name))).toThrow();
  expect(() => bind([...jobs, jobs.find(j => j.name === name)!])).toThrow();
 });
}
test("GitHub identity, job source/run/status and failure boundaries", () => {
 for (const patch of [{head_sha: "b".repeat(40)}, {id: 43}, {status: "in_progress"}, {conclusion: "cancelled"}, {repository: {full_name: "fork/dinobot"}}, {path: ".github/workflows/ci.yml"}, {event: "pull_request"}]) expect(() => bind(jobs, {...run, ...patch})).toThrow();
 for (const patch of [{head_sha: "b".repeat(40)}, {run_id: 43}, {status: "in_progress"}]) expect(() => bind(jobs.map((j,i) => i === 0 ? {...j,...patch} : j))).toThrow();
 expect(() => bind([...jobs, {...jobs[0]!, name: "Another job", conclusion: "failure"}])).toThrow();
 const j = structuredClone(jobs); j.at(-1)!.steps.at(-1)!.name = "Setup npm";
 expect(() => bind(j)).toThrow();
 j.at(-1)!.steps = jobs.at(-1)!.steps.slice(1); expect(() => bind(j)).toThrow();
 expect(() => bindSource(run, sha, "42", "github")).toThrow();
});
const zip = Buffer.from("immutable zip fixture");
const artifact: Artifact = {id: 123, name: "npm-" + sha, expired: false, digest: "sha256:" + createHash("sha256").update(zip).digest("hex"), workflow_run: { id: 42, head_sha: sha }};
test("exact unique artifact ID/source and downloaded ZIP digest", () => {
 expect(selectArtifact([artifact],run).id).toBe(123);
 expect(() => bindArtifact(zip,artifact)).not.toThrow();
 expect(() => bindArtifact(Buffer.from("mutated"),artifact)).toThrow();
 for (const patch of [{id: 0}, {expired: true}, {digest: ""}, {name: "npm-other"}, {workflow_run: {id: 43, head_sha: sha}}, {workflow_run: {id: 42, head_sha: "b".repeat(40)}}]) expect(() => selectArtifact([{...artifact,...patch}],run)).toThrow();
 expect(() => selectArtifact([],run)).toThrow();
 expect(() => selectArtifact([artifact,artifact],run)).toThrow();
});
test("CI checksum stays mandatory without npm", () => {
 const sums = createHash("sha512").update(zip).digest("hex") + "  dinobot-0.8.4.tgz";
 expect(bindCiTarball(zip,sums,"0.8.4")).toBe(createHash("sha256").update(zip).digest("hex"));
 for (const [data,sum,version] of [[Buffer.from("changed"),sums,"0.8.4"], [zip,sums,"0.8.5"], [zip,"", "0.8.4"], [zip,sums,"0.8.4-local.1"]] as const) expect(() => bindCiTarball(data,sum,version)).toThrow();
});
test("source manifest binds consumed source blobs and exact version", () => {
 const files = {"package.json": Buffer.from(JSON.stringify({name: "dinobot", version: "0.8.4", private: true})), "script/release-audit.ts": Buffer.from("auditor")};
 const manifest = Object.entries(files).map(([p,b]) => createHash("sha256").update(b).digest("hex") + "  " + p).join("\n");
 expect(() => bindSourceFiles(manifest,files,"0.8.4")).not.toThrow();
 expect(() => bindSourceFiles(manifest,files,"0.8.5")).toThrow();
 expect(() => bindSourceFiles(manifest,{...files,"script/release-audit.ts": Buffer.from("changed")},"0.8.4")).toThrow();
 expect(() => bindSourceFiles(manifest + "\n" + manifest,files,"0.8.4")).toThrow();
 expect(() => bindSourceFiles("",files,"0.8.4")).toThrow();
});
