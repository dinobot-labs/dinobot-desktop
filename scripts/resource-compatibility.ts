import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
export type RuntimeFile = { path: string; sha256: string };
/** Compare every candidate host file and native executable, not just a displayed Electron version. */
export function compareRuntime(candidate: RuntimeFile[], installed: RuntimeFile[]): void {
 const have = new Map(installed.map(f => [f.path.toLowerCase(), f.sha256]));
 if (!candidate.some(f => f.path.toLowerCase() === "dinobot.exe")) throw new Error("Candidate Electron executable missing");
 for (const f of candidate) {
  if (have.get(f.path.toLowerCase()) !== f.sha256) throw new Error("Runtime/native mismatch: " + f.path);
 }
}
export function runtimeFiles(root: string): RuntimeFile[] {
 const files: RuntimeFile[]=[];
 const walk=(dir:string) => { for(const e of readdirSync(dir,{withFileTypes:true})) {
  const path=resolve(dir,e.name);
  if(e.isSymbolicLink()) throw new Error("Unexpected runtime symlink");
  if(e.isDirectory()) { walk(path); continue; }
  const rel=relative(root,path).replaceAll("\\","/");
  const lower=rel.toLowerCase();
  // New JS/web bytes are allowed. Every native executable/module and all Electron host files must match.
  const mutable=lower === "resources/app.asar" || lower.startsWith("resources/web/") || lower.startsWith("resources/daemon/");
  if(mutable && !/\.(exe|dll|node|sys|com|scr)$/i.test(rel)) continue;
  files.push({path:rel,sha256:createHash("sha256").update(readFileSync(path)).digest("hex")});
 }};
 walk(root);
 return files;
}
if(import.meta.main) {
 const [candidateArg,installedArg]=process.argv.slice(2);
 if(!candidateArg || !installedArg || process.argv.length!==4) throw new Error("Usage: bun scripts/resource-compatibility.ts CANDIDATE_WIN_UNPACKED INSTALLED_APP");
 const candidate=realpathSync(candidateArg), installed=realpathSync(installedArg);
 if(candidate.toLowerCase()===installed.toLowerCase()) throw new Error("Candidate must be a separate directory");
 const want=runtimeFiles(candidate), have=runtimeFiles(installed);
 compareRuntime(want,have);
 console.log(JSON.stringify({compatible:true,scope:"Exact host/native byte compatibility only; no files changed, no executable launched, no policy changed",candidate,installed,runtimeFiles:want},null,2));
}
