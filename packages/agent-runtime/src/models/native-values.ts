import type { ModelResponseProvenance } from '@skaro/timeline';
export function nativeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid native model object');
  return value as Record<string, unknown>;
}
export function nativeText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid native model text');
  return value;
}
export function nativeTokens(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function unknownUsage(): ModelResponseProvenance['usage'] {
  return {
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    reasoningTokens: null,
    cost: null,
  };
}
