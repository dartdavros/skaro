import type {
  RuntimeScopedExtensionHost,
  RuntimeRpcRequest,
  RuntimeRpcReply,
} from '@skaro/timeline';
import { z } from 'zod';
import { RuntimeRpcServer } from '../rpc/server.ts';
import { ExtensionRegistry } from './registry.ts';

const invocation = z.strictObject({
  callId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
  args: z.record(z.string(), z.unknown()),
});

/** Revalidates the trusted catalogue at each boundary and preserves original host handlers. */
export class ExtensionServer {
  private readonly rpc: RuntimeRpcServer;
  private readonly registry: ExtensionRegistry;
  private closing?: Promise<void>;
  constructor(
    host: RuntimeScopedExtensionHost,
    send: (reply: RuntimeRpcReply) => void,
    requireOwner: (signal: AbortSignal) => Promise<void>,
  ) {
    const tools = host.extensions.tools.map((tool) => ({
      ...tool,
      invoke: tool.invoke.bind(tool),
    }));
    this.registry = new ExtensionRegistry(
      tools.map(({ name, revision, readOnly }) => ({ name, revision, readOnly })),
      {
        tools,
        close: host.extensions.close.bind(host.extensions),
        interrupt: host.extensions.interrupt?.bind(host.extensions),
      },
    );
    this.rpc = new RuntimeRpcServer({
      send,
      requireOwner,
      signal: host.signal,
      dispatch: async (name, raw, signal) => {
        if (name === '@interrupt') {
          if (raw !== null) throw new Error('Invalid extension lifecycle request');
          await this.registry.interrupt();
          await this.rpc.drain('@interrupt');
          return null;
        }
        const { callId, args } = invocation.parse(raw);
        return this.registry.invoke(callId, name, args, signal);
      },
    });
  }
  receive(request: RuntimeRpcRequest): void {
    this.rpc.receive(request);
  }
  close(): Promise<void> {
    this.rpc.close();
    return (this.closing ??= (async () => {
      try {
        await this.registry.close();
      } finally {
        await this.rpc.drain();
      }
    })());
  }
}
