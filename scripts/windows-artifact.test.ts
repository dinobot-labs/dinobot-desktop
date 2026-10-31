import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { bindSource, bindTarball, type Run } from "./windows-artifact.ts";
const sha = "a".repeat(40);
const run: Run = { id: 42, head_sha: sha, status: "completed", conclusion: "success", path: ".github/workflows/release.yml", event: "push", repository: { full_name: "dinobot-labs/dinobot" } };
test("binds official successful release run to exact tag", () => { expect(() => bindSource(run, sha, "42")).not.toThrow(); });
for (const patch of [{head_sha:"b".repeat(40)}, {status:"in_progress"}, {conclusion:"failure"}, {path:".github/workflows/ci.yml"}, {event:"pull_request"}, {repository:{full_name:"other/dinobot"}}, {id:43}]) {
 test("rejects mismatched release identity " + JSON.stringify(patch), () => { expect(() => bindSource({...run,...patch},sha,"42")).toThrow(); });
}
const bytes = Buffer.from("actual immutable payload bytes");
const digest = createHash("sha512").update(bytes).digest();
const sums = digest.toString("hex") + "  dinobot-0.8.4.tgz";
const integrity = "sha512-" + digest.toString("base64");
test("CI bytes and npm integrity bind SHA256", () => { expect(bindTarball(bytes,sums,"0.8.4",integrity)).toBe(createHash("sha256").update(bytes).digest("hex")); });
test("rejects mutated payload", () => { expect(() => bindTarball(Buffer.from("changed"),sums,"0.8.4",integrity)).toThrow(); });
test("rejects registry mismatch", () => { expect(() => bindTarball(bytes,sums,"0.8.4","sha512-other")).toThrow(); });
test("rejects wrong version and prerelease", () => { for(const version of ["0.8.5", "0.8.4-local.1"]) expect(() => bindTarball(bytes,sums,version,integrity)).toThrow(); });
