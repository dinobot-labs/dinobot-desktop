import { createHash } from "node:crypto";
import type { Run } from "./windows-artifact.ts";

export type Job = { id: number; run_id: number; head_sha: string; name: string; status: string; conclusion: string; steps: { name: string; conclusion: string }[] };
export const SOURCE_JOBS = ["Select immutable source", "Verify release source / Tests and types", "Verify release source / Performance budgets", "Verify release source / Package and leak checks", "Verify release source / CI"] as const;
const PUBLISH = "Publish audited npm tarball";
const PUBLISH_STEP = "Publish through npm Trusted Publishing (no stored npm token)";
export function bindJobs(run: Run, jobs: Job[]): void {
 if (jobs.some(j => j.run_id !== run.id || j.head_sha !== run.head_sha || j.status !== "completed")) throw new Error("Job source/run mismatch or incomplete job");
 for (const name of [...SOURCE_JOBS, ...(run.event === "push" ? ["Release PR and tag"] : [])]) {
  const found = jobs.filter(j => j.name === name);
  if (found.length !== 1 || found[0]!.conclusion !== "success") throw new Error("Required source job did not succeed: " + name);
 }
 const failed = jobs.filter(j => j.conclusion !== "success" && j.conclusion !== "skipped");
 if (run.conclusion === "success" && failed.length) throw new Error("Inconsistent successful run");
 if (run.conclusion === "failure") {
  if (failed.length !== 1 || failed[0]!.name !== PUBLISH || failed[0]!.conclusion !== "failure") throw new Error("Failure is not solely npm publication");
  const steps = failed[0]!.steps;
  const errors = steps.filter(s => s.conclusion !== "success" && s.conclusion !== "skipped");
  if (errors.length !== 1 || errors[0]!.name !== PUBLISH_STEP || errors[0]!.conclusion !== "failure") throw new Error("Failure is not the npm publish step");
  for (const name of ["Bind tag to the tested source", "Recheck exact downloaded bytes and payload", "Refuse conflicts, downgrades, and ambiguous registry failures"]) {
   const found = steps.filter(s => s.name === name);
   if (found.length !== 1 || found[0]!.conclusion !== "success") throw new Error("Publish preflight did not pass");
  }
 }
}
export type Artifact = { id: number; name: string; expired: boolean; digest: string; workflow_run: { id: number; head_sha: string } };
export function selectArtifact(artifacts: Artifact[], run: Run): Artifact {
 const matches = artifacts.filter(a => a.name === "npm-" + run.head_sha);
 if (matches.length !== 1) throw new Error("Expected one exact source artifact");
 const a = matches[0]!;
 if (!Number.isSafeInteger(a.id) || a.id <= 0 || a.expired !== false || !/^sha256:[a-f0-9]{64}$/.test(a.digest) || a.workflow_run.id !== run.id || a.workflow_run.head_sha !== run.head_sha) throw new Error("Artifact provenance mismatch");
 return a;
}
export function bindArtifact(bytes: Uint8Array, artifact: Artifact): void {
 if ("sha256:" + createHash("sha256").update(bytes).digest("hex") !== artifact.digest) throw new Error("Artifact ZIP digest mismatch");
}
/** Verify the exact immutable Git blobs used here against the source-owned manifest. */
export function bindSourceFiles(manifest: string, files: Record<string, Uint8Array>, version: string): void {
 const entries = new Map<string, string>();
 for (const line of manifest.trimEnd().split("\n")) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!match || entries.has(match[2]!)) throw new Error("Invalid SOURCE manifest");
  entries.set(match[2]!, match[1]!);
 }
 for (const [name, bytes] of Object.entries(files)) {
  if (entries.get(name) !== createHash("sha256").update(bytes).digest("hex")) throw new Error("SOURCE manifest mismatch: " + name);
 }
 const pkg = JSON.parse(Buffer.from(files["package.json"]!).toString("utf8"));
 if (pkg.name !== "dinobot" || pkg.version !== version || pkg.private !== true) throw new Error("Source package version mismatch");
}
