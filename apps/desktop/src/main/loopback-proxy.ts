const LOOPBACK = ['localhost', '127.0.0.1', '::1'];

/**
 * Skaro's MCP server and task environments listen on loopback. An inherited HTTP(S)_PROXY must not
 * carry those requests: a local proxy cuts long tool calls (xray answers HTTP 503 after 600 s).
 * Agents, checks and environments inherit the exclusion from this process.
 */
export function keepLoopbackDirect(env: NodeJS.ProcessEnv = process.env): void {
  const names = Object.keys(env).filter((name) => /^no_proxy$/i.test(name));
  const hosts = names
    .flatMap((name) => (env[name] ?? '').split(','))
    .map((host) => host.trim())
    .filter(Boolean);
  if (hosts.includes('*')) return;
  const value = [...new Set([...hosts, ...LOOPBACK])].join(',');
  for (const name of new Set(['NO_PROXY', 'no_proxy', ...names])) env[name] = value;
}
