import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServer, RuntimeProcessIdentity } from '@skaro/timeline';
import { cleanCommandEnvironment } from '../tools/command-env.ts';
import { processBirth, stopOwnedProcess } from '../process-identity.ts';

export interface McpProcessHost {
  /** Must durably admit ownership before initialize/tools requests. */
  admit(owner: RuntimeProcessIdentity, signal: AbortSignal): Promise<void>;
  exited(owner: RuntimeProcessIdentity): Promise<void>;
}
class OwnedStdio extends StdioClientTransport {
  private owner?: RuntimeProcessIdentity;
  private readonly host: McpProcessHost;
  private readonly signal: AbortSignal;
  private closing?: Promise<void>;
  constructor(
    config: Extract<McpServer, { type: 'stdio' }>,
    cwd: string,
    host: McpProcessHost,
    signal: AbortSignal,
  ) {
    if (process.platform !== 'win32')
      throw new Error('MCP stdio process-tree ownership is not verified for this OS');
    const env = Object.fromEntries(
      Object.entries(cleanCommandEnvironment()).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    for (const [name, value] of Object.entries(config.env ?? {})) {
      if (
        /^(OPENAI|ANTHROPIC|DEEPSEEK|OPENROUTER)_/i.test(name) ||
        /^(NODE_OPTIONS|NODE_PATH)$/i.test(name)
      )
        throw new Error('Model or Node injection environment cannot enter MCP');
      env[name] = value;
    }
    super({
      command: config.command,
      args: [...config.args],
      env,
      cwd,
      stderr: 'ignore',
      maxBufferSize: 4_194_304,
    });
    this.host = host;
    this.signal = signal;
  }
  override async start(): Promise<void> {
    this.signal.throwIfAborted();
    await super.start();
    try {
      const pid = this.pid;
      if (!pid) throw new Error('MCP process exited during startup');
      const birth = await processBirth(pid);
      if (!birth) throw new Error('MCP process identity unavailable');
      this.owner = { pid, birth, platform: process.platform };
      await this.host.admit(this.owner, this.signal);
      this.signal.throwIfAborted();
    } catch {
      await this.close();
      throw new Error('MCP process admission failed');
    }
  }
  override close(): Promise<void> {
    this.closing ??= (async () => {
      if (this.owner) {
        // Stop the verified tree while its root still exists, before closing stdin.
        await stopOwnedProcess(this.owner);
        await this.host.exited(this.owner);
      }
      await super.close();
    })();
    return this.closing;
  }
}
export function mcpTransport(
  config: McpServer,
  cwd: string,
  signal: AbortSignal,
  host?: McpProcessHost,
): Transport {
  if (config.type === 'stdio') {
    if (!host) throw new Error('MCP stdio requires a process ownership host');
    return new OwnedStdio(config, cwd, host, signal);
  }
  const url = new URL(config.url);
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Unsafe MCP endpoint');
  const endpoint = url.href;
  const headers = new Headers(config.headers);
  return new StreamableHTTPClientTransport(url, {
    requestInit: { headers, redirect: 'error' },
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 100,
      maxReconnectionDelay: 100,
      reconnectionDelayGrowFactor: 1,
    },
    fetch: async (target, init) => {
      if (new URL(String(target)).href !== endpoint) throw new Error('MCP endpoint changed');
      const response = await fetch(target, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([
          signal,
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(60_000),
        ]),
      });
      if (!response.body) return response;
      let size = 0;
      const body = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            size += chunk.byteLength;
            if (size > 4_194_304) throw new Error('MCP response exceeds its size limit');
            controller.enqueue(chunk);
          },
        }),
      );
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  });
}
