import { expect, it } from 'vitest';
import { keepLoopbackDirect } from './loopback-proxy';

it('adds loopback to the inherited proxy exclusions without dropping the owner hosts', () => {
  const env: NodeJS.ProcessEnv = {
    HTTP_PROXY: 'http://127.0.0.1:10809',
    no_proxy: 'corp.local, localhost',
  };
  keepLoopbackDirect(env);
  expect(env['NO_PROXY']).toBe('corp.local,localhost,127.0.0.1,::1');
  expect(env['no_proxy']).toBe(env['NO_PROXY']);
  keepLoopbackDirect(env);
  expect(env['NO_PROXY']).toBe('corp.local,localhost,127.0.0.1,::1');
});

it('keeps an exclusion of every host as it is', () => {
  const env: NodeJS.ProcessEnv = { NO_PROXY: '*' };
  keepLoopbackDirect(env);
  expect(env).toEqual({ NO_PROXY: '*' });
});
