export interface ComposePort {
  target: number;
  published?: string;
  protocol?: string;
  host_ip?: string;
  [key: string]: unknown;
}
export interface ComposeModel {
  volumes?: Record<string, { name?: string; external?: boolean }>;
  networks?: Record<string, { name?: string; external?: boolean }>;
  services: Record<string, { ports?: ComposePort[]; [key: string]: unknown }>;
}

/** Host access is explicit: unallocated services stay reachable inside the Compose network. */
export function managedPortPlan(model: ComposeModel, ports: Record<string, number>) {
  const allocated = new Set(Object.values(ports));
  const endpoints = new Map<string, string>();
  const services: Record<string, { ports: ComposePort[] }> = {};
  const used = new Set<string>();
  for (const [service, spec] of Object.entries(model.services)) {
    if (!spec.ports?.length) continue;
    const kept: ComposePort[] = [];
    for (const binding of spec.ports) {
      const port = Number(binding.published);
      if (!allocated.has(port)) continue;
      if (!Number.isInteger(binding.target) || binding.target < 1 || binding.target > 65535)
        throw new Error(`Invalid container port of ${service}`);
      const protocol = binding.protocol ?? 'tcp';
      if (protocol !== 'tcp' && protocol !== 'udp')
        throw new Error(`Unsupported port protocol of ${service}: ${protocol}`);
      const socket = `${port}/${protocol}`;
      if (used.has(socket)) throw new Error(`Host port ${socket} is shared by multiple services`);
      used.add(socket);
      kept.push({ ...binding, published: String(port), host_ip: '127.0.0.1' });
      endpoints.set(`${service}/${binding.target}/${protocol}`, `127.0.0.1:${port}`);
    }
    services[service] = { ports: kept };
  }
  return { services, endpoints: Object.fromEntries(endpoints) };
}

/** Validate Docker's final merge, so normal Compose array merging cannot restore an unsafe port. */
export function assertManagedPorts(model: ComposeModel, ports: Record<string, number>): void {
  const allocated = new Set(Object.values(ports));
  for (const [name, service] of Object.entries(model.services))
    for (const binding of service.ports ?? [])
      if (!allocated.has(Number(binding.published)) || binding.host_ip !== '127.0.0.1')
        throw new Error(`Compose still publishes an unmanaged host port for ${name}`);
}
