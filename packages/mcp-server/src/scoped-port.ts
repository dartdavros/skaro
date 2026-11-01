import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { ScopedOperationPort, ProcessAdmissionPort, SkaroScope } from '@skaro/timeline';
import type { Tool } from './server.ts';
import { operationCatalogue } from './catalogue.ts';

/** Internal transport over the exact existing handlers/availability, never a second workflow. */
export function scopedOperationPort<S extends SkaroScope>(input: {
  tools: readonly Tool<S>[];
  scope: S;
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
      return operationCatalogue(input.tools, scope);
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
