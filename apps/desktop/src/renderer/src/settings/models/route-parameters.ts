import type { OpenRouterCatalogEntry } from '@skaro/agent-runtime';
import { openRouterEfforts } from '@skaro/agent-runtime/openrouter-effort';

/** JSON remains authoritative; choosing an effort never replaces unrelated or invalid input. */
export function effortParameters(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
export function withEffort(text: string, effort: string): string {
  const value = effortParameters(text);
  if (!value) return text;
  if (effort) value.reasoning_effort = effort;
  else delete value.reasoning_effort;
  return JSON.stringify(value);
}
/** Unknown/unavailable catalogs do not erase choices or claim incompatibility. */
export function unsupportedEffort(
  model: Pick<OpenRouterCatalogEntry, 'reasoning'> | undefined,
  text: string,
): boolean {
  const effort = effortParameters(text)?.reasoning_effort;
  return !!model && typeof effort === 'string' && !openRouterEfforts(model).includes(effort);
}
