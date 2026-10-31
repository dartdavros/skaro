import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@skaro/timeline';
import { createHash } from 'node:crypto';
import type { RuntimeExtension, RuntimeExtensionHost } from './registry.ts';
import { mcpTransport, type McpProcessHost } from './mcp-transport.ts';
import { UnknownToolOutcome } from '../tools/effect-error.ts';
import { ModelSecretGuard } from '../models/secret-guard.ts';
import { mcpContent, type McpImageStore } from './mcp-content.ts';

/** No server annotation can grant writes, access a model credential or bypass a host allowlist. */
export async function connectMcpExtension(input: {
  id: string;
  config: McpServer;
  cwd: string;
  signal: AbortSignal;
  processes?: McpProcessHost;
  allowed: readonly {
    name: string;
    readOnly: boolean;
    observation?: { kind: 'browser'; criteria: readonly string[] };
  }[];
  images?: McpImageStore;
}): Promise<RuntimeExtensionHost> {
  if (
    !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id) ||
    input.allowed.length > 32 ||
    new Set(input.allowed.map((tool) => tool.name)).size !== input.allowed.length
  )
    throw new Error('Invalid MCP host allowlist');
  const signal = input.signal;
  const values =
    input.config.type === 'http'
      ? Object.values(input.config.headers ?? {}).map((value) => value.replace(/^Bearer\s+/i, ''))
      : Object.entries(input.config.env ?? {})
          .filter(([key]) => /(TOKEN|KEY|SECRET|PASSWORD)/i.test(key))
          .map(([, value]) => value);
  const guards = values
    .filter((value) => value.length > 3)
    .map((value) => new ModelSecretGuard(value));
  const requireSafe = (value: unknown) => {
    for (const guard of guards) guard.requireSafe(value);
  };
  const client = new Client({ name: 'skaro-builtin', version: '1.0.0' }, { capabilities: {} });
  const transport = mcpTransport(structuredClone(input.config), input.cwd, signal, input.processes);
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= client.close());
  const cancel = () => void close().catch(() => undefined);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    await client.connect(transport, { timeout: 20_000, signal });
    const catalogue: Tool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 16; page++) {
      const response = await client.listTools(cursor ? { cursor } : {}, {
        signal,
        timeout: 20_000,
      });
      requireSafe(response);
      catalogue.push(...response.tools);
      if (!response.nextCursor) break;
      if (cursors.has(response.nextCursor) || page === 15)
        throw new Error('MCP catalogue pagination is cyclic or oversized');
      cursors.add(response.nextCursor);
      cursor = response.nextCursor;
    }
    const tools: RuntimeExtension[] = input.allowed.map((allowed) => {
      if (
        allowed.observation &&
        (allowed.observation.kind !== 'browser' ||
          !allowed.observation.criteria.length ||
          allowed.observation.criteria.length > 100 ||
          allowed.observation.criteria.some(
            (id) => typeof id !== 'string' || !id.trim() || id.length > 200,
          ))
      )
        throw new Error('Invalid host observation policy');
      const matches = catalogue.filter((tool) => tool.name === allowed.name);
      if (matches.length !== 1 || !/^[a-zA-Z0-9_-]+$/.test(allowed.name))
        throw new Error('Allowed MCP tool is unavailable or ambiguous');
      const tool = matches[0]!;
      const revision = createHash('sha256')
        .update(
          JSON.stringify({
            id: input.id,
            name: tool.name,
            description: tool.description ?? '',
            schema: tool.inputSchema,
            readOnly: allowed.readOnly,
            observation: allowed.observation,
          }),
        )
        .digest('hex');
      return {
        name: `mcp__${input.id}__${tool.name}`,
        revision,
        readOnly: allowed.readOnly,
        observation: allowed.observation && structuredClone(allowed.observation),
        description: tool.description ?? tool.name,
        inputSchema: structuredClone(tool.inputSchema),
        invoke: async (_id, args, callSignal) => {
          const active = AbortSignal.any([signal, callSignal]);
          active.throwIfAborted();
          try {
            const result = await client.callTool({ name: tool.name, arguments: args }, undefined, {
              signal: active,
              timeout: 60_000,
            });
            active.throwIfAborted();
            requireSafe(result);
            return {
              ...(await mcpContent(result.content, input.images, active)),
              ...(result.isError ? { isError: true } : {}),
            };
          } catch {
            // A remote failure/timeout does not prove the tool had no side effect.
            throw new UnknownToolOutcome(
              'MCP call did not produce a confirmed result; automatic replay forbidden',
            );
          }
        },
      };
    });
    return {
      tools,
      close: async () => {
        signal.removeEventListener('abort', cancel);
        await close();
      },
    };
  } catch {
    signal.removeEventListener('abort', cancel);
    await close().catch(() => undefined);
    throw new Error('MCP connection or host catalogue admission failed');
  }
}
