import { z } from 'zod';

export const processIdentity = z.strictObject({
  pid: z.number().int().positive(),
  birth: z.string().min(1).max(200),
  platform: z.string().min(1).max(32),
});
const scope = z.strictObject({
  kind: z.enum(['task', 'project_chat', 'integration']),
  projectId: z.string().min(1).max(200),
  taskId: z.string().max(200).optional(),
  runId: z.string().max(200).optional(),
  chatId: z.string().max(200).optional(),
  integrationId: z.string().max(200).optional(),
  importId: z.string().max(200).optional(),
});
export const admissionState = z.strictObject({
  schema: z.literal(1),
  admission: z.strictObject({
    id: z.uuid(),
    sessionId: z.string().min(1).max(200),
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
  scope,
  host: processIdentity,
  owner: processIdentity.optional(),
  status: z.enum(['prepared', 'active', 'revoked', 'exited']),
  reason: z.string().max(256).optional(),
});
export type AdmissionState = z.infer<typeof admissionState>;
