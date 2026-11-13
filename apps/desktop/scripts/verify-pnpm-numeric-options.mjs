import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import Module from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { pnpmCommandArguments } from '../src/main/managed-pnpm-arguments.ts';

// Actual fifth residue only. This diagnostic never calls fetch/install or the returned requester.
// Exact startup capability set: excludes write grants, config files, inspector, children and workers.
assert.deepEqual(process.execArgv, ['--permission', '--allow-fs-read=*']);
assert(!process.env.NODE_OPTIONS, 'NODE_OPTIONS must be unset at diagnostic startup');
const data = resolve(process.env.SKARO_PNPM_NUMERIC_DIAGNOSTIC_DATA ?? '');
assert(process.env.SKARO_PNPM_NUMERIC_DIAGNOSTIC_DATA, 'Explicit actual-data opt-in required');
const key = 'a69b5a56a69a44f5490356be30d9d5de0c1fa7aa9b961aa46449d2f526846635';
const root = join(data, 'managed-caches-v1');
const work = join(root, 'scratch', `${key}-publish`);
const home = join(work, 'home');
assert.equal(
  process.permission?.has('fs.write', work),
  false,
  'Run Node with --permission --allow-fs-read=* and NO write grant',
);
assert.equal(process.permission.has('child'), false);
assert.equal(process.permission.has('worker'), false);
assert.equal(realpathSync(work), work);
const filename = join(root, 'dependencies', key, 'runtime', 'dist', 'pnpm.cjs');
const sdk = readFileSync(filename);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256(sdk), '543ea6b75da3dfc98f1a0fe64061ab545824160b103f59044a3afe54579cf555');
const inputFiles = [
  'package.json',
  'pnpm-lock.yaml',
  '.npmrc',
  'home/user.npmrc',
  'home/global.npmrc',
];
const inputHashes = inputFiles.map((file) => sha256(readFileSync(join(work, file))));
const allowed = new Set([
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'PATHEXT',
  'COMSPEC',
]);
for (const name of Object.keys(process.env)) if (!allowed.has(name)) delete process.env[name];
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  TEMP: home,
  TMP: home,
  LANG: 'C',
  CI: 'true',
  NO_UPDATE_NOTIFIER: '1',
  NODE_DISABLE_COMPILE_CACHE: '1',
  PNPM_HOME: join(home, 'pnpm'),
  XDG_CONFIG_HOME: join(home, 'config'),
  XDG_DATA_HOME: join(home, 'data'),
  XDG_CACHE_HOME: join(home, 'cache'),
});
process.chdir(work);
// The SDK's own top-level command is help only; the exposed ORIGINAL function bodies are unchanged.
process.argv = [process.execPath, filename, 'fetch', '--help'];
const loaded = new Module(filename);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(dirname(filename));
loaded._compile(
  sdk.toString() +
    '\nmodule.exports.readonlyDiagnostic = {parseCliArgs:require_parseCliArgs().parseCliArgs,getConfig:require_lib96().getConfig,rcOptionsTypes:require_cmd().rcOptionsTypes,createPackageRequester:require_packageRequester().createPackageRequester};\n',
  filename,
);
const api = loaded.exports.readonlyDiagnostic;
const results = [];
for (const action of ['fetch', 'install']) {
  const production = pnpmCommandArguments(
    filename,
    action,
    work,
    home,
    join(root, 'dependencies', key, 'store'),
    join(work, 'node_modules'),
  ).slice(3);
  for (const historicalStrings of [true, false]) {
    const argv = historicalStrings
      ? production.map((arg) =>
          arg.replace(/^--(fetch-retries|network-concurrency|child-concurrency)=/, '--config.$1='),
        )
      : production;
    const parsed = await api.parseCliArgs(argv);
    assert.equal(parsed.cmd, action);
    assert.equal(parsed.unknownOptions.size, 0);
    const config = await api.getConfig(parsed.options, {
      excludeReporter: false,
      globalDirShouldAllowWrite: true,
      rcOptionsTypes: api.rcOptionsTypes,
      workspaceDir: parsed.workspaceDir,
      checkUnknownSetting: false,
      ignoreNonAuthSettingsFromLocal: false,
    });
    let error;
    let requester;
    try {
      requester = api.createPackageRequester(config);
    } catch (caught) {
      error = caught;
    }
    if (historicalStrings) {
      assert.equal(config.networkConcurrency, '1');
      assert.equal(config.childConcurrency, '1');
      assert.equal(config.fetchRetries, '0');
      assert.equal(error?.name, 'TypeError');
      assert.equal(
        error?.message,
        'Expected `concurrency` to be a number from 1 and up, got `1` (string)',
      );
    } else {
      assert.equal(config.networkConcurrency, 1);
      assert.equal(config.childConcurrency, 1);
      assert.equal(config.fetchRetries, 0);
      assert.equal(error, undefined);
      assert.equal(typeof requester, 'function');
      assert.equal(config.offline, true);
      assert.equal(config.ignoreScripts, true);
      assert.equal(config.frozenLockfile, true);
      assert.equal(config.dev, true);
      assert.equal(config.production, true);
      assert.equal(config.modulesDir, 'node_modules');
    }
    results.push({
      action,
      historicalStrings,
      numeric: !historicalStrings,
      constructor: error ? 'known-concurrency-type-error' : 'passed',
    });
  }
}
assert.deepEqual(
  inputFiles.map((file) => sha256(readFileSync(join(work, file)))),
  inputHashes,
);
assert.equal(sha256(readFileSync(filename)), sha256(sdk));
console.log(
  JSON.stringify({
    diagnosticPassed: true,
    liveAcceptance: false,
    sdkSha256: sha256(sdk),
    filesystemWritesForbidden: true,
    requesterNeverInvoked: true,
    results,
  }),
);
