import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Execute the workflow's PowerShell, replacing only the packaging process with
// electron-builder's real CLI parser + config validator. Never builds or signs.
const root = resolve(import.meta.dir, '..');
const workflow = Bun.YAML.parse(await Bun.file(join(root, '.github/workflows/windows-package.yml')).text()) as { jobs: { package: { steps: { name?: string; run?: string }[] } } };
const command = workflow.jobs.package.steps.find(step => step.name === 'Windows NSIS only, optional signing (never publish from builder)')!.run!;
const builder = realpathSync(join(root, 'apps/desktop/node_modules/electron-builder/package.json'));

function probe(sign: boolean, credentials: boolean) {
 const dir = mkdtempSync(join(tmpdir(), 'windows-builder-'));
 try {
  const js = join(dir, 'probe.cjs');
  writeFileSync(js, `
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const r = createRequire(${JSON.stringify(builder)});
const {createYargs, configureBuildCommand, normalizeOptions} = r('./out/builder.js');
const {validateConfiguration} = r('app-builder-lib/out/util/config/config.js');
const {getPublishConfigs} = r('app-builder-lib/out/publish/PublishManager.js');
const {createUpdateInfoTasks} = r('app-builder-lib/out/publish/updateInfoBuilder.js');
(async () => {
 const argv = process.argv.slice(2);
 assert.deepEqual(argv.slice(0, 3), ['x', '--no-install', 'electron-builder']);
 const options = normalizeOptions(configureBuildCommand(createYargs()).parse(argv.slice(3)));
 assert.equal(typeof options.config, 'object', 'override must not become a config filename');
 await validateConfiguration(options.config, {isEnabled:false});
 assert.equal(options.config.forceCodeSigning, ${sign});
 assert.equal(options.publish, 'never');
 // Match CI: GH_TOKEN exists but checkout has no discoverable repository.
 const packager = {config:options.config, platformSpecificBuildOptions:{}, expandMacro: value => value,
  appInfo:{channel:null}, info:{config:options.config, repositoryInfo:Promise.resolve(null), appInfo:{channel:null}}};
 const publishers = await getPublishConfigs(packager, options.config.nsis, 1, false);
 assert.equal(publishers, null, 'package-only NSIS must disable implicit publishers');
 assert.deepEqual(await createUpdateInfoTasks({packager, arch:1}, publishers), []);
 assert.deepEqual([...options.targets].map(([p,a]) => [p.name,[...a]]), [['windows',[[1,['nsis']]]]]);
 assert.equal(Boolean(process.env.CSC_LINK), ${sign});
 assert.equal(Boolean(process.env.CSC_KEY_PASSWORD), ${sign});
 if (!${sign}) assert.equal(process.env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
 console.log('validated');
})().catch(e => { console.error(e); process.exitCode = 1; });
`);
  const ps = join(dir, 'probe.ps1');
  writeFileSync(ps, "$ErrorActionPreference = 'Stop'\nfunction bun { & node $env:BUILDER_PROBE @args; $global:LASTEXITCODE = $LASTEXITCODE }\n" + command);
  return Bun.spawnSync(['pwsh', '-NoProfile', '-File', ps], {
   cwd: root, env: { ...process.env, GH_TOKEN: 'test-only-token', BUILDER_PROBE: js, REQUIRE_SIGNATURE: String(sign),
    CSC_LINK: credentials ? 'test-only-not-a-certificate' : '', CSC_KEY_PASSWORD: credentials ? 'test-only' : '' },
   stdout: 'pipe', stderr: 'pipe',
  });
 } finally { rmSync(dir, {recursive:true, force:true}); }
}

// PowerShell is available on the official Windows runner and GitHub Ubuntu CI.
for (const sign of [false, true]) {
 test('PowerShell builder override preserves signing=' + sign, () => {
  const result = probe(sign, true);
  expect(result.stderr.toString()).toBe('');
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain('validated');
 });
}
test('requested signing without credentials fails before builder invocation', () => {
 const result = probe(true, false);
 expect(result.exitCode).not.toBe(0);
 expect(result.stderr.toString()).toContain('Requested signing credentials are unavailable');
 expect(result.stdout.toString()).not.toContain('validated');
});
