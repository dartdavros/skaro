/** Explicit owner-selected local VPN proxy for acceptance hosts, never inherited by tools. */
export function liveProxyEnvironment(input: unknown): Record<string, string> {
  if (typeof input !== 'string' || !input)
    throw new Error('An explicit live VPN proxy is required');
  const url = new URL(input);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Live VPN proxy must be a credential-free loopback HTTP endpoint');
  return {
    SKARO_VERIFY_PROXY: url.href,
    NODE_USE_ENV_PROXY: '1',
    HTTP_PROXY: url.href,
    HTTPS_PROXY: url.href,
    NO_PROXY: 'localhost,127.0.0.1,[::1]',
  };
}
