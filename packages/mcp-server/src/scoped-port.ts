import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { ScopedOperationPort, ProcessAdmissionPort, SkaroScope } from '@skaro/timeline';
import type { Tool } from './server.ts';

/** Internal transport over the exact existing handlers/availability, never a second workflow. */
export function scopedOperationPort(input: {
  tools: readonly Tool<SkaroScope>[];
  scope: SkaroScope;
  admissions: Pick<ProcessAdmissionPort, 'requireActive'>;
}): ScopedOperationPort {
  const scope = structuredClone(input.scope);
  if (new Set(input.tools.map((tool) => tool.name)).size !== input.tools.length)
    throw new Error('Ambiguous scoped operation catalogue');
  const validator = new AjvJsonSchemaValidator();
  const tools = input.tools.map((tool) => ({
    tool,
    validate: validator.getValidator<Record<string, unknown>>(tool.inputSchema),
  }));
  return {
    catalog: async (admission, signal) => {
      signal.throwIfAborted();
      await input.admissions.requireActive(admission, signal);
      signal.throwIfAborted();
      return tools
        .filter(({ tool }) => !tool.available || tool.available(scope))
        .map(({ tool }) => ({
          name: tool.name,
          inputSchema: structuredClone(tool.inputSchema),
        }));
    },
    execute: async (request) => {
      request.signal.throwIfAborted();
      await input.admissions.requireActive(request.admission, request.signal);
      request.signal.throwIfAborted();
      const entry = tools.find(
        ({ tool }) => tool.name === request.name && (!tool.available || tool.available(scope)),
      );
      if (!entry) throw new Error('Operation is outside the bound Skaro scope');
      const args = entry.validate(structuredClone(request.args));
      if (!args.valid) throw new Error('Invalid scoped operation arguments');
      const result = await entry.tool.call(args.data, structuredClone(scope));
      request.signal.throwIfAborted();
      await input.admissions.requireActive(request.admission, request.signal);
      request.signal.throwIfAborted();
      return result;
    },
  };
}
