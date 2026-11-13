import { describe, expect, it } from 'vitest';
import { verifyAuditConclusion, type AuditSnapshot } from './c4-audit-snapshot';
import { c4ApplicationFailureState } from './c4-package-decision';
import { auditCanStop } from '../shared/c4-audit';

// Pure protocol DTOs only: no backend, checkout, agent, filesystem fixture or seeded project.
const snapshot: AuditSnapshot = {
  fingerprint: 'observed-version',
  files: [{ path: 'index.html', hash: 'content-hash' }],
  complete: true,
  unresolved: false,
  context: '',
};
const conclusion = {
  outcome: 'unchanged',
  summary: 'Sources inspected',
  fingerprint: snapshot.fingerprint,
  evidence: ['index.html'],
};
describe('full audit evidence and application authority', () => {
  it('rejects stale or non-existent evidence and keeps incomplete knowledge partial', () => {
    expect(() =>
      verifyAuditConclusion(snapshot, { ...conclusion, fingerprint: 'older-version' }),
    ).toThrow('inputs changed');
    expect(() =>
      verifyAuditConclusion(snapshot, { ...conclusion, evidence: ['missing.js'] }),
    ).toThrow('actual source');
    expect(verifyAuditConclusion(snapshot, conclusion).result).toBe('unchanged');
    expect(verifyAuditConclusion(snapshot, { ...conclusion, evidence: [] }).result).toBe('partial');
    expect(verifyAuditConclusion({ ...snapshot, unresolved: true }, conclusion).result).toBe(
      'partial',
    );
    expect(verifyAuditConclusion({ ...snapshot, complete: false }, conclusion).result).toBe(
      'partial',
    );
  });
  it('never downgrades accepted consent on a failed or unknown physical result', () => {
    for (const status of ['unwritten', 'writing', undefined])
      expect(c4ApplicationFailureState(status)).toBe('accepted');
    expect(c4ApplicationFailureState('applied')).toBe('applied');
    expect(auditCanStop('applying')).toBe(false);
    expect(auditCanStop('stopping')).toBe(false);
    expect(auditCanStop('model')).toBe(true);
  });
});
