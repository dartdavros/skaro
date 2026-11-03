import { z } from 'zod';

const usageSources = z.array(
  z.strictObject({
    kind: z.enum(['tasks', 'chats']),
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
  }),
);
export const parseModelUsageSources = (value: unknown) => usageSources.parse(value);
