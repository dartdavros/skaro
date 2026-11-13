import { expect, it } from 'vitest';
import { isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { pnpmCommandArguments } from './managed-pnpm-command';
import {
  pnpmCommandFailure,
  pnpmCommandPhase,
  pnpmDiagnosticCode,
} from './managed-pnpm-diagnostics';
import { isolatedNpmEnvironment } from './managed-cache-command';
import { PNPM_CONFIGURATION } from './managed-pnpm-lock';

it('uses supported prefixed config flags and the neutral all-dependencies branch for fetch/install', () => {
  for (const action of ['fetch', 'install'] as const) {
    const home = resolve('home');
    const args = pnpmCommandArguments(
      resolve('pnpm.cjs'),
      action,
      resolve('.'),
      home,
      resolve('store'),
      resolve('node_modules'),
    );
    expect(args).toContain(`--config.userconfig=${resolve(home, 'user.npmrc')}`);
    expect(args).toContain(`--config.globalconfig=${resolve(home, 'global.npmrc')}`);
    expect(args).toContain('--reporter=ndjson');
    expect(args).toContain('--config.optional=true');
    for (const [name, value] of [
      ['fetch-retries', 0],
      ['network-concurrency', 1],
      ['child-concurrency', 1],
    ]) {
      expect(args).toContain(`--${name}=${value}`);
      expect(args.some((arg) => arg.startsWith(`--config.${name}=`))).toBe(false);
    }
    expect(args.some((arg) => /^--(?:config\.)?(?:production|dev)(?:=|$)/.test(arg))).toBe(false);
    expect(args.some((arg) => /^--(?:userconfig|globalconfig)=/.test(arg))).toBe(false);
    expect(args).toContain('--offline');
    expect(args).toContain('--frozen-lockfile');
    expect(args).toContain('--ignore-scripts');
    expect(pnpmCommandPhase(args)).toBe(action);
  }
  expect(isolatedNpmEnvironment(resolve('.')).NODE_ENV).toBeUndefined();
  expect(PNPM_CONFIGURATION.commandProfile).toBe(
    'supported-config-relative-modules-typed-limits-all-dependencies-ndjson-v5',
  );
});
it('matches pnpm path.join semantics for same-root and sibling private targets', () => {
  const work = resolve('scratch/work');
  for (const modules of [
    join(work, 'node_modules'),
    resolve('verification-inputs/input/node_modules'),
  ]) {
    const args = pnpmCommandArguments('pinned.cjs', 'install', work, 'home', 'store', modules);
    const value = args
      .find((arg) => arg.startsWith('--modules-dir='))!
      .slice('--modules-dir='.length);
    expect(isAbsolute(value)).toBe(false);
    expect(value).toBe(relative(work, modules));
    expect(join(work, value)).toBe(modules);
    expect(args).toContain(`--virtual-store-dir=${join(modules, '.pnpm')}`);
  }
  expect(() => pnpmCommandArguments('pinned.cjs', 'fetch', work, 'home', 'store', work)).toThrow(
    'modules_directory_unsupported',
  );
  if (process.platform === 'win32')
    expect(() =>
      pnpmCommandArguments('pinned.cjs', 'fetch', work, 'home', 'store', 'Z:\\target'),
    ).toThrow('modules_directory_unsupported');
});
it('demonstrates the original Windows absolute modules-dir mismatch without filesystem effects', () => {
  const work = 'C:\\Users\\owner\\cache\\scratch\\work';
  const target = 'C:\\Users\\owner\\cache\\inputs\\target\\node_modules';
  expect(win32.join(work, target)).not.toBe(target);
  expect(win32.join(work, win32.relative(work, target))).toBe(target);
});
it('extracts only bounded NDJSON protocol codes, never raw errors, paths or registry credentials', () => {
  const secret = 'Bearer-private-credential';
  const raw = `not JSON ${secret}\n${JSON.stringify({ err: { code: 'ERR_PNPM_NO_OFFLINE_TARBALL', message: secret, stack: secret } })}\n`;
  expect(pnpmDiagnosticCode(raw)).toBe('ERR_PNPM_NO_OFFLINE_TARBALL');
  const error = pnpmCommandFailure('install', 1, raw, secret);
  expect(error.message).toBe('managed_pnpm_install_failed_exit_1_ERR_PNPM_NO_OFFLINE_TARBALL');
  expect(String(error.stack)).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
  for (const code of [
    'ERR_PNPM_bad',
    'ERR_PNPM_X\nTOKEN',
    `ERR_PNPM_${'A'.repeat(81)}`,
    'TOKEN',
    1,
  ])
    expect(pnpmDiagnosticCode(JSON.stringify({ err: { code } }))).toBeUndefined();
});
it('recognizes pnpm early pretty errors and finite OS/worker codes without leaking messages', () => {
  const secret = 'Bearer-private-credential';
  for (const code of ['ERR_PNPM_BAD_PM_VERSION', 'ENOENT', 'EPERM', 'ERR_WORKER_INIT_FAILED']) {
    const early = JSON.stringify({ error: { code, message: secret } }, null, 2);
    const reported = JSON.stringify({ err: { code, message: secret, path: secret } });
    expect(pnpmDiagnosticCode(early)).toBe(code);
    expect(pnpmDiagnosticCode(reported)).toBe(code);
    expect(pnpmCommandFailure('fetch', 1, early, secret).message).toBe(
      `managed_pnpm_fetch_failed_exit_1_${code}`,
    );
    expect(String(pnpmCommandFailure('fetch', 1, reported, secret).stack)).not.toContain(secret);
  }
  for (const code of ['E_PRIVATE_TOKEN', 'ERR_WORKER_PRIVATE_TOKEN', secret])
    expect(pnpmDiagnosticCode(JSON.stringify({ error: { code } }))).toBeUndefined();
  expect(pnpmDiagnosticCode(' '.repeat(1024 * 1024 + 1))).toBeUndefined();
});
it('preserves phase/exit and safe fallback when configuration fails before the reporter starts', () => {
  expect(pnpmCommandPhase(['pnpm.cjs', '--version'])).toBe('version');
  expect(pnpmCommandFailure('fetch', 1, 'raw private path', 'unknown private flags').message).toBe(
    'managed_pnpm_fetch_failed_exit_1_unreported',
  );
  expect(pnpmCommandFailure('fetch', null, '', '').message).toContain('exit_unknown');
  expect(pnpmCommandFailure('command', Infinity, '', '').message).toContain('exit_unknown');
  expect(pnpmDiagnosticCode('[]\nnull\n42\n{"err":[]}\n{"err":{"code":{}}}')).toBeUndefined();
});
