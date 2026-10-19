import { expect, test } from 'bun:test';
import { forbiddenContent, forbiddenPath, checkSnapshot } from './public-snapshot-guard.ts';
import { resolve } from 'node:path';
test('public source guard accepts clean source and rejects sensitive/generated paths',()=>{
 for(const p of ['apps/web/src/main.tsx','LICENSES/react--LICENSE','docs/wiki/Home.md'])expect(forbiddenPath(p)).toBe(false);
 for(const p of ['.env','apps/web/.env.local','qa/fixtures/session.jsonl','reports/result.json','services/worker.ts','apps/desktop/vendor/daemon/main.js','apps/web/dist/main.js','capture.png','state.sqlite','archive.tgz','scripts/release.ts'])expect(forbiddenPath(p)).toBe(true);
});
test('public source guard rejects credential signatures and binary content',()=>{
 expect(forbiddenContent('synthetic test example')).toBe(false);
 expect(forbiddenContent('gh'+'p_'+'a'.repeat(36))).toBe(true);
 expect(forbiddenContent('-----BEGIN '+'PRIVATE KEY-----')).toBe(true);
 expect(forbiddenContent('text'+String.fromCharCode(0))).toBe(true);
});
test('actual public snapshot passes the guard',()=>expect(checkSnapshot(resolve(import.meta.dir,'..'))).toBeGreaterThan(200));
