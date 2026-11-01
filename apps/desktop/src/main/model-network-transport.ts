import { session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { ModelFetch } from '@skaro/agent-runtime';
import { liveProxyEnvironment } from './credentials/live-proxy';

/** An isolated Chromium network session honors OS proxy; verification pins the owner's VPN. */
export async function modelNetworkTransport(proxy?: string): Promise<ModelFetch> {
  const explicit = proxy === undefined ? undefined : liveProxyEnvironment(proxy).HTTPS_PROXY;
  const network = session.fromPartition(`skaro-model-metadata-${randomUUID()}`, { cache: false });
  if (explicit)
    await network.setProxy({
      mode: 'fixed_servers',
      proxyRules: new URL(explicit).origin,
      proxyBypassRules: '<-loopback>',
    });
  return async (url, init) => {
    init?.signal?.throwIfAborted();
    if (
      explicit &&
      (await network.resolveProxy(url.toString())) !== `PROXY ${new URL(explicit).host}`
    )
      throw new Error('Verification model metadata requires its exact VPN proxy');
    init?.signal?.throwIfAborted();
    return network.fetch(url.toString(), { ...init, credentials: 'omit', cache: 'no-store' });
  };
}
