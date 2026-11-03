import { z } from 'zod';

export const evidenceReference = z.strictObject({
  sequence: z.number().int().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const commandCheck = z.strictObject({
  name: z.string().min(1).max(200),
  criteria: z.array(z.string().min(1).max(200)).min(1).max(100),
  command: z.string().min(1).max(100_000),
  cwd: z.string().min(1).max(4096).optional(),
  shell: z.enum(['powershell', 'cmd', 'sh', 'bash']).optional(),
  timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
});
export const plannedCheck = evidenceReference.extend({ stepId: z.string().min(1).max(100) });
export const checkPlan = z.strictObject({
  criteriaRevision: z.string().regex(/^[a-f0-9]{64}$/),
  checks: z.array(commandCheck.extend({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) })).max(64),
  uncovered: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(200),
        reason: z.string().min(1).max(4096),
      }),
    )
    .max(128),
});
export const checkAssessment = z.strictObject({
  criteriaRevision: z.string().regex(/^[a-f0-9]{64}$/),
  verdicts: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(200),
        met: z.boolean(),
        evidence: z.array(evidenceReference).max(32),
      }),
    )
    .max(128),
});
