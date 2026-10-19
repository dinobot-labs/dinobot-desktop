import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
export function forbiddenPath(path: string): boolean {
 const p=path.replaceAll('\\','/');
 return /(^|\/)(\.env(?:\..*)?|\.dinobot|node_modules|vendor|dist|release|reports|qa|services|screens|coverage|test-results|playwright-report)(\/|$)/i.test(p)
  || /\.(sqlite(?:-wal|-shm)?|db|jsonl|zip|tgz|tar|exe|dll|dmg|jsc|png|jpe?g|webp|woff2?)$/i.test(p)
  || /^scripts\/(invite|release|cf-r2|install)(\.|\/)/.test(p);
}
export function forbiddenContent(text: string): boolean {
 return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
  || /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})/.test(text)
  || text.includes(String.fromCharCode(0));
}
export function checkSnapshot(root: string): number {
 const git=Bun.spawnSync(['git','-C',root,'rev-parse','--show-toplevel'],{stdout:'pipe',stderr:'pipe'});
 const gitRoot=git.exitCode===0?git.stdout.toString().trim():'';
 let files:string[]=[];
 if(gitRoot && realpathSync(gitRoot)===realpathSync(root)) {
  const list=Bun.spawnSync(['git','-C',root,'ls-files','-z'],{stdout:'pipe',stderr:'pipe'});
  if(list.exitCode) throw new Error('Cannot inspect tracked files');
  files=list.stdout.toString().split('\0').filter(Boolean);
 } else {
  // Pre-publication snapshot without its own Git history. Skip only disposable build outputs.
  const skip=new Set(['node_modules','.git','dist','build','coverage']);
  function walk(dir:string,prefix='') { for(const e of readdirSync(dir,{withFileTypes:true})) {
   const p=prefix+e.name;
   if(e.isSymbolicLink()) throw new Error('Unexpected source symlink: '+p);
   if(e.isDirectory()) {if(!skip.has(e.name))walk(join(dir,e.name),p+'/');}
   else if(!p.endsWith('.log')) files.push(p);
  }} walk(root);
 }
 if(!files.length)throw new Error('Empty source snapshot');
 for(const p of files) {
  if(forbiddenPath(p))throw new Error('Forbidden public path: '+p);
  if(forbiddenContent(readFileSync(join(root,p),'utf8')))throw new Error('Sensitive or binary content: '+p);
 }
 const license=readFileSync(join(root,'LICENSE'));
 if(createHash('sha256').update(license).digest('hex')!=='ffcca38841adb694b6f380647e15f17c446a4d1656fed51a1e2041d064c94cc8')throw new Error('PolyForm text changed');
 const workflow=readFileSync(join(root,'.github/workflows/public-source.yml'),'utf8');
 if(/self-hosted|pull_request_target|upload-artifact|secrets\.|contents: write/.test(workflow))throw new Error('Unsafe public CI');
 for(const match of workflow.matchAll(/uses:\s*(\S+)/g))if(!/@[a-f0-9]{40}$/.test(match[1]!))throw new Error('Unpinned action');
 return files.length;
}
if(import.meta.main) console.log('Public snapshot guard passed: '+checkSnapshot(resolve(import.meta.dir,'..'))+' files');
