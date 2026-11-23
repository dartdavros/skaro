const outcomes = ['not_applicable', 'unavailable', 'failed'] as const;

export interface VerificationObservation {
  name: string;
  outcome: (typeof outcomes)[number];
  reason: string;
}

export const verificationObservationsSchema = {
  type: 'array',
  description:
    'Record checks that were not applicable, unavailable or failed. Each required outcome still needs its own criterion verdict.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      outcome: { type: 'string', enum: outcomes },
      reason: { type: 'string' },
    },
    required: ['name', 'outcome', 'reason'],
    additionalProperties: false,
  },
};

export function readVerificationObservations(value: unknown): VerificationObservation[] | string {
  if (!Array.isArray(value)) return 'verification_observations must be an array.';
  const result: VerificationObservation[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return 'A verification observation must be an object.';
    const { name, outcome, reason } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim() || typeof reason !== 'string' || !reason.trim())
      return 'A verification observation needs a name and a concrete reason.';
    if (outcome !== 'not_applicable' && outcome !== 'unavailable' && outcome !== 'failed')
      return 'Invalid verification observation outcome.';
    result.push({ name: name.trim(), outcome, reason: reason.trim() });
  }
  return result;
}
