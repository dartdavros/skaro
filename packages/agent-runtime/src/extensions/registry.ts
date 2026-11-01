import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/types.js';
import type {
  BuiltinExtensionPolicy,
  RuntimeExtension,
  RuntimeExtensionHost,
} from '@skaro/timeline';
export type { RuntimeExtension, RuntimeExtensionHost } from '@skaro/timeline';
export class ExtensionRegistry {
  private readonly entries = new Map<
    string,
    { tool: RuntimeExtension; validate: JsonSchemaValidator<Record<string, unknown>> }
  >();
  private readonly host?: RuntimeExtensionHost;
  private closed = false;
  constructor(policy: readonly BuiltinExtensionPolicy[], host?: RuntimeExtensionHost) {
    if (policy.length > 64 || (host?.tools.length ?? 0) !== policy.length)
      throw new Error('Configured extension host is unavailable');
    const validator = new AjvJsonSchemaValidator();
    for (const entry of policy) {
      const tool = host?.tools.find((tool) => tool.name === entry.name);
      if (
        !/^mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+$/.test(entry.name) ||
        !tool ||
        this.entries.has(entry.name) ||
        tool.revision !== entry.revision ||
        tool.readOnly !== entry.readOnly
      )
        throw new Error('Extension host differs from persisted policy');
      if (
        Buffer.byteLength(JSON.stringify(tool.inputSchema)) > 65_536 ||
        tool.inputSchema.type !== 'object'
      )
        throw new Error('Invalid extension input schema');
      this.entries.set(entry.name, {
        tool: {
          ...tool,
          inputSchema: structuredClone(tool.inputSchema),
          observation: tool.observation && structuredClone(tool.observation),
        },
        validate: validator.getValidator<Record<string, unknown>>(tool.inputSchema),
      });
    }
    this.host = host;
  }
  has(name: string): boolean {
    return this.entries.has(name);
  }
  readOnly(name: string): boolean {
    return this.entries.get(name)?.tool.readOnly === true;
  }
  observation(name: string) {
    const tool = this.entries.get(name)?.tool;
    return tool?.observation
      ? { ...structuredClone(tool.observation), name: tool.name, revision: tool.revision }
      : undefined;
  }
  parse(name: string, args: unknown): Record<string, unknown> {
    if (this.closed) throw new Error('Extension host closed; reopen the admitted host scope');
    const entry = this.entries.get(name);
    if (!entry) throw new Error('Extension is outside the host catalogue');
    const parsed = entry.validate(structuredClone(args));
    if (!parsed.valid) throw new Error('Invalid extension tool arguments');
    if (Buffer.byteLength(JSON.stringify(parsed.data)) > 65_536)
      throw new Error('Extension arguments exceed the review limit');
    return parsed.data;
  }
  invoke(
    id: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const entry = this.entries.get(name);
    if (!entry) throw new Error('Extension is outside the host catalogue');
    return entry.tool.invoke(id, this.parse(name, args), signal);
  }
  catalog() {
    return [...this.entries.values()].map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: structuredClone(tool.inputSchema),
    }));
  }
  async interrupt(): Promise<void> {
    if (this.host?.interrupt) await this.host.interrupt();
    else await this.close();
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.host?.close();
  }
}
