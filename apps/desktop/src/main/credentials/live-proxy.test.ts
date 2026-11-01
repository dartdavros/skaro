import { expect, it } from 'vitest';
import { liveProxyEnvironment } from './live-proxy';

it('selects the explicit local VPN proxy and bypasses only local services', () => {
  const proxy = liveProxyEnvironment('http://127.0.0.1:10809');
  expect(proxy).toEqual({
    SKARO_VERIFY_PROXY: 'http://127.0.0.1:10809/',
    NODE_USE_ENV_PROXY: '1',
    HTTP_PROXY: 'http://127.0.0.1:10809/',
    HTTPS_PROXY: 'http://127.0.0.1:10809/',
    NO_PROXY: 'localhost,127.0.0.1,[::1]',
  });
});

it('rejects implicit direct routing, credentials and nonlocal proxy targets', () => {
  for (const value of [
    undefined,
    '',
    'http://proxy.example.org:10809',
    'http://user:password@127.0.0.1:10809',
    'http://127.0.0.1:10809/path',
    'http://127.0.0.1:10809?bypass=1',
    'socks5://127.0.0.1:10808',
  ])
    expect(() => liveProxyEnvironment(value)).toThrow();
});
