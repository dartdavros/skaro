import { incidentHash, type IncidentCause } from '@skaro/core';

/** Typed protocol codes take precedence; text alone never merges failures across unrelated resources. */
export function incidentFailure(error: unknown): { cause: IncidentCause; code: string } {
  const e =
    error && typeof error === 'object'
      ? (error as { code?: unknown; category?: unknown; message?: unknown })
      : {};
  const code = String(e.code ?? e.category ?? '').toLowerCase();
  const text = String(e.message ?? error).toLowerCase();
  if (
    /context_length|context_window|context_limit/.test(code) ||
    /context (window|length).*(exceed|limit)/.test(text)
  )
    return { cause: 'context', code: 'context_limit' };
  if (
    /insufficient_quota|quota_exceeded|usage_limit/.test(code) ||
    /usage limit|quota exceeded/.test(text)
  )
    return { cause: 'quota', code: 'quota_exhausted' };
  if (/budget/.test(code) || /budget.*(exceed|exhaust)/.test(text))
    return { cause: 'budget', code: 'budget_exhausted' };
  if (/rate_limit|429/.test(code) || /rate limit/.test(text))
    return { cause: 'rate-limit', code: 'provider_rate_limit' };
  if (/auth|401|403/.test(code) || /authentication|not logged in|invalid api key/.test(text))
    return { cause: 'authentication', code: 'provider_authentication' };
  if (/no.progress|stalled/.test(code)) return { cause: 'no-progress', code: 'no_progress' };
  return {
    cause: 'external',
    code: code.replace(/[^a-z0-9_-]/g, '_').slice(0, 80) || `executor_${incidentHash(text)}`,
  };
}
