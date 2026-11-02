import { z } from 'zod';
import type { BuiltinVerificationReview } from '@skaro/timeline';
import type { CheckEvidence, BrowserEvidence } from './evidence.ts';
import type { captureCheckEnvironment } from './environment.ts';
import { fingerprint } from './inputs.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const verificationReviewSchema: z.ZodType<BuiltinVerificationReview> = z
  .strictObject({
    revision: hash,
    criteriaRevision: hash,
    dependencies: hash,
    commands: z.array(hash).max(64),
    observations: z
      .array(z.strictObject({ name: z.string().min(1).max(200), revision: hash, argsHash: hash }))
      .max(32),
    assumptions: z
      .array(
        z.strictObject({
          concern: z.enum([
            'ignored files and installed dependencies',
            'external services and mutable environment',
            'command toolchain resolution and binaries',
          ]),
          rationale: z.string().min(1).max(4096),
        }),
      )
      .max(3),
  })
  .superRefine((value, context) => {
    if (
      (!value.commands.length && !value.observations.length) ||
      new Set(value.assumptions.map((item) => item.concern)).size !== value.assumptions.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Review must cover exact checks with unique assumptions',
      });
  });

export function verificationCommandHash(
  evidence: Pick<CheckEvidence, 'command' | 'cwd' | 'shell' | 'criteria' | 'timeoutMs'>,
) {
  return fingerprint({
    command: evidence.command,
    cwd: evidence.cwd,
    shell: evidence.shell,
    criteria: [...evidence.criteria].sort(),
    timeoutMs: evidence.timeoutMs ?? 120000,
  });
}

/** Retain measured uncertainty in the receipt and report exact host-reviewed assumptions separately. */
export function reviewedCheckEnvironment(
  input: BuiltinVerificationReview | undefined,
  evidence:
    | Pick<CheckEvidence, 'kind' | 'command' | 'cwd' | 'shell' | 'criteria' | 'timeoutMs'>
    | Pick<BrowserEvidence, 'kind' | 'source'>,
  current: Pick<Awaited<ReturnType<typeof captureCheckEnvironment>>, 'dependencies'>,
) {
  if (!input) return undefined;
  const review = verificationReviewSchema.parse(input);
  if (!current.dependencies || review.dependencies !== fingerprint(current.dependencies))
    return undefined;
  const allowed =
    evidence.kind === 'command-check'
      ? review.commands.includes(verificationCommandHash(evidence))
      : review.observations.some(
          (item) =>
            item.name === evidence.source.name &&
            item.revision === evidence.source.revision &&
            item.argsHash === evidence.source.argsHash,
        );
  if (!allowed) return undefined;
  return {
    revision: review.revision,
    criteriaRevision: review.criteriaRevision,
    coverage: 'host-reviewed-assumptions' as const,
    assumptions: review.assumptions,
  };
}
