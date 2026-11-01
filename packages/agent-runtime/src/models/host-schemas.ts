import { z } from 'zod';
import type { RouteSnapshot, ChatRequest, NativeRequest } from '@skaro/timeline';

const object = z.record(z.string(), z.unknown());
const route = z.custom<RouteSnapshot>(
  (value) => !!value && typeof value === 'object' && !Array.isArray(value),
);
const context = z
  .strictObject({ revision: z.string().max(200), epoch: z.number().int().min(0) })
  .optional();
export const modelToolSchema = z.strictObject({
  name: z.string().min(1).max(200),
  description: z.string(),
  parameters: object,
});
const tools = z.array(modelToolSchema).max(128).optional();
const call = z.strictObject({
  id: z.string(),
  type: z.literal('function'),
  function: z.strictObject({ name: z.string(), arguments: z.string() }),
});
const message = z.strictObject({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(call).max(128).optional(),
  reasoning: z.string().optional(),
  reasoning_content: z.string().optional(),
  reasoning_details: z.array(object).optional(),
  refusal: z.string().optional(),
});
const chat: z.ZodType<ChatRequest> = z.strictObject({
  route,
  context,
  tools,
  messages: z.array(message).max(16_384),
  toolChoice: z.enum(['auto', 'required', 'none']).optional(),
  price: z.strictObject({
    prompt: z.number().nonnegative(),
    completion: z.number().nonnegative(),
    request: z.number().nonnegative().optional(),
  }),
});
const native: z.ZodType<NativeRequest> = z.strictObject({
  route,
  context,
  tools,
  input: z.array(object).max(16_384),
  system: z.string().optional(),
});
export const modelInvocation = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
  request: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('chat'), value: chat }),
    z.strictObject({ kind: z.literal('native'), value: native }),
  ]),
});
export const preparedModelTurn = z.strictObject({
  request: modelInvocation.shape.request,
  maxSteps: z.number().int().min(1).max(100),
});
