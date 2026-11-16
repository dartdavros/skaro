import type { IncidentProtocol } from '@skaro/core';

export function assertIncidentCondition(protocol: Pick<IncidentProtocol, 'cause' | 'condition'>) {
  if (
    protocol.condition === 'provider-evidence' &&
    !['quota', 'authentication'].includes(protocol.cause)
  )
    throw new Error(
      'provider-evidence only verifies quota or authentication. Bind an existing project check, registered environment or recorded agent recovery for this failure.',
    );
}

export function assertIncidentVerification(
  protocol: Pick<IncidentProtocol, 'cause' | 'condition'>,
  bound: boolean,
) {
  if (bound) return;
  assertIncidentCondition(protocol);
  if (protocol.condition === 'owner-evidence')
    throw new Error(
      'Bind an existing verification_check, verification_environment or verification_agent before offering a resolution. An owner answer alone cannot verify this incident.',
    );
}
