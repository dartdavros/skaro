import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { prepareEnvironmentSetup } from './environment-setup.ts';

// Pure metadata contracts: no fake services, project fixtures, commands or source data.
const environment = {
  start: 'docker compose up -d --wait',
  ports: ['WEB_PORT'],
  env: {},
  urls: { web: 'http://localhost:{WEB_PORT}' },
};

it('creates only the missing environment and preserves unrelated settings and inheritance', () => {
  const before =
    '# owner configuration\npermission_mode: ask\ncustom: preserved\nchecks:\n  - pnpm test\n';
  const initial = prepareEnvironmentSetup(before);
  expect(initial.environment).toBeNull();
  const saved = prepareEnvironmentSetup(before, {
    environment,
    expectedRevision: initial.revision,
  });
  expect(saved.content).toContain('# owner configuration');
  const { environment: written, ...other } = parse(saved.content!);
  expect(other).toEqual(parse(before));
  expect(written.start).toBe(environment.start);
  const reread = prepareEnvironmentSetup(saved.content!);
  expect(reread.environment).toEqual(environment);
  expect(reread.revision).not.toBe(initial.revision);
  expect(() =>
    prepareEnvironmentSetup(saved.content!, {
      environment,
      expectedRevision: reread.revision,
    }),
  ).toThrow('already exists');
});

it('rejects stale setup, malformed existing declarations and unsafe port ownership without overwriting', () => {
  const revision = prepareEnvironmentSetup(null).revision;
  expect(() =>
    prepareEnvironmentSetup('permission_mode: ask\n', {
      environment,
      expectedRevision: revision,
    }),
  ).toThrow('configuration changed');
  expect(() => prepareEnvironmentSetup('environment: broken')).toThrow('must be a mapping');
  expect(() => prepareEnvironmentSetup('environment: [')).toThrow();
  for (const invalid of [
    { ...environment, ports: ['COMPOSE_PROJECT_NAME'] },
    { ...environment, env: { WEB_PORT: '80' } },
    { ...environment, start: 'run {UNKNOWN}' },
    { ...environment, create: 123 },
    { ...environment, readiness: 'mistyped' },
  ])
    expect(() =>
      prepareEnvironmentSetup(null, {
        environment: invalid,
        expectedRevision: revision,
      }),
    ).toThrow();
});

it('accepts a missing file and keeps copying and readiness declarations on reread', () => {
  const next = {
    ...environment,
    create: 'scripts/clone {root} {name}',
    ready: 'http://localhost:{WEB_PORT}/ready',
    source: { project: 'main', services: ['db'] },
  };
  const saved = prepareEnvironmentSetup(null, {
    environment: next,
    expectedRevision: prepareEnvironmentSetup(null).revision,
  });
  expect(prepareEnvironmentSetup(saved.content!).environment).toEqual(next);
});
