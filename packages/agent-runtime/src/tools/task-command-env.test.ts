import { expect, it } from 'vitest';
import {
  taskCommandEnvironment,
  taskCommandEnvironmentRevision,
  requireTaskCommandEnvironment,
} from './task-command-env.ts';

it('binds explicit host task variables by stable revision without mutating or retaining caller objects', () => {
  const source = { SKARO_ENV_NAME: 'scoped-task', PORT: '3000' };
  const revision = taskCommandEnvironmentRevision(source)!;
  expect(taskCommandEnvironmentRevision({ PORT: '3000', SKARO_ENV_NAME: 'scoped-task' })).toBe(
    revision,
  );
  expect(requireTaskCommandEnvironment(source, revision)).toEqual(source);
  expect(requireTaskCommandEnvironment(source, revision)).not.toBe(source);
  expect(requireTaskCommandEnvironment(undefined)).toBeUndefined();
  expect(() => requireTaskCommandEnvironment({ ...source, PORT: '3001' }, revision)).toThrow();
  expect(() => requireTaskCommandEnvironment(undefined, revision)).toThrow();
  expect(() => requireTaskCommandEnvironment(source)).toThrow();
});

it('refuses runtime overrides, Windows case collisions and malformed/oversized environments', () => {
  const invalid: Record<string, string>[] = [
    { NODE_OPTIONS: '--import=untrusted' },
    { node_path: 'other' },
    { ELECTRON_RUN_AS_NODE: '1' },
    { SKARO_COMMAND_NODE: 'other' },
    { SKARO_COMMAND_ENTRY: 'other' },
    { PORT: '3000', port: '3001' },
    { PORT: 'x\0y' },
    { 'bad-name': 'value' },
    { constructor: 'value' },
    { PORT: 'x'.repeat(131073) },
  ];
  for (const value of invalid) expect(() => taskCommandEnvironment(value)).toThrow();
});
