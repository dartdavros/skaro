import { createServer } from 'node:net';

const FIRST = 20_000;
const LAST = 39_999;

/** Whether nothing listens on the port now, on any interface. */
export function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '0.0.0.0', exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });
}

/**
 * Host ports for a new environment: free now and not promised to another environment, whose
 * services may be stopped at the moment.
 */
export async function allocatePorts(
  count: number,
  taken: ReadonlySet<number>,
  isFree: (port: number) => Promise<boolean> = portIsFree,
): Promise<number[]> {
  const ports: number[] = [];
  for (let port = FIRST; port <= LAST && ports.length < count; port++) {
    if (!taken.has(port) && (await isFree(port))) ports.push(port);
  }
  if (ports.length < count) throw new Error('No free ports for the task environment');
  return ports;
}
