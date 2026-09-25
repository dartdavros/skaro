// Skaro MCP server over Streamable HTTP (architecture.md 6, 10): localhost only, stateless
// JSON responses, a bearer token per agent session. The token decides the scope (project, task)
// and which tools the session sees.

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface Tool<S> {
  name: string;
  description: string;
  /** JSON schema of the arguments (an object schema). */
  inputSchema: Record<string, unknown>;
  /** Tools a session sees depend on its scope (task run, project chat…). */
  available?: (scope: S) => boolean;
  call(args: Record<string, unknown>, scope: S): Promise<ToolResult>;
}

export interface Grant {
  url: string;
  headers: Record<string, string>;
  revoke(): void;
}

/** Protocol versions we speak; the client's is echoed when known (newest first). */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 4 * 1024 * 1024;

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export class McpHttpServer<S> {
  private readonly name: string;
  private readonly version: string;
  private readonly tools: Tool<S>[];
  private readonly scopes = new Map<string, S>();
  private server: Server | undefined;
  private port = 0;

  constructor(options: { name: string; version: string; tools: Tool<S>[] }) {
    this.name = options.name;
    this.version = options.version;
    this.tools = options.tools;
  }

  async listen(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
  }

  get url(): string {
    if (!this.server) throw new Error('MCP server is not listening');
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  /** Access for one agent session. */
  grant(scope: S): Grant {
    const token = randomBytes(24).toString('base64url');
    this.scopes.set(token, scope);
    return {
      url: this.url,
      headers: { Authorization: `Bearer ${token}` },
      revoke: () => this.scopes.delete(token),
    };
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.scopes.clear();
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const path = (req.url ?? '').split('?')[0];
      if (path !== '/mcp') return send(res, 404);
      // Browsers cannot reach us: no CORS, and a page's Origin is refused outright.
      if (req.headers.origin) return send(res, 403);
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const scope = token === undefined ? undefined : this.scopes.get(token);
      if (scope === undefined) return send(res, 401);
      // Stateless: no server-to-client stream, no sessions to delete.
      if (req.method !== 'POST') return send(res, 405, undefined, { Allow: 'POST' });

      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, rpcError(null, -32700, 'Parse error'));
      }
      const messages = Array.isArray(body) ? body : [body];
      const replies: unknown[] = [];
      for (const message of messages) {
        const reply = await this.dispatch(message as RpcRequest, scope);
        if (reply !== undefined) replies.push(reply);
      }
      if (!replies.length) return send(res, 202);
      return send(res, 200, Array.isArray(body) ? replies : replies[0]);
    } catch {
      if (!res.headersSent) send(res, 500);
    }
  }

  /** Handles one JSON-RPC message; notifications get no reply. */
  private async dispatch(msg: RpcRequest, scope: S): Promise<unknown> {
    if (typeof msg !== 'object' || msg === null || typeof msg.method !== 'string') {
      return rpcError(msg?.id ?? null, -32600, 'Invalid request');
    }
    if (msg.id === undefined || msg.id === null) return undefined;
    const id = msg.id;
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.['protocolVersion'];
        return rpcResult(id, {
          protocolVersion:
            typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked)
              ? asked
              : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: this.name, version: this.version },
        });
      }
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, {
          tools: this.visible(scope).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });
      case 'tools/call': {
        const name = msg.params?.['name'];
        const tool = this.visible(scope).find((t) => t.name === name);
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
        const args = msg.params?.['arguments'];
        let result: ToolResult;
        try {
          result = await tool.call(
            typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
            scope,
          );
        } catch (error) {
          result = { text: error instanceof Error ? error.message : String(error), isError: true };
        }
        return rpcResult(id, {
          content: [{ type: 'text', text: result.text }],
          ...(result.isError ? { isError: true } : {}),
        });
      }
      default:
        return rpcError(id, -32601, `Method not found: ${msg.method}`);
    }
  }

  private visible(scope: S): Tool<S>[] {
    return this.tools.filter((t) => !t.available || t.available(scope));
  }
}

function rpcResult(id: string | number, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function send(
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): void {
  if (body === undefined) {
    res.writeHead(status, headers).end();
    return;
  }
  res
    .writeHead(status, { 'Content-Type': 'application/json', ...headers })
    .end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
