import type { ModelCatalogEntry } from '@skaro/agent-runtime';
import { catalogEfforts, effortParameter } from '@skaro/agent-runtime/catalog-effort';

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
export function withEffort(text: string, effort: string, connector = 'openrouter'): string {
  const value = effortParameters(text);
  if (!value) return text;
  const key = effortParameter(connector);
  if (effort) value[key] = effort;
  else delete value[key];
  return JSON.stringify(value);
}
/** Unknown/unavailable catalogs do not erase choices or claim incompatibility. */
export function unsupportedEffort(
  model: Pick<ModelCatalogEntry, 'reasoning'> | undefined,
  text: string,
  connector = 'openrouter',
): boolean {
  const effort = effortParameters(text)?.[effortParameter(connector)];
  return (
    !!model &&
    (connector === 'openrouter' || model.reasoning?.supportedEfforts !== undefined) &&
    typeof effort === 'string' &&
    !catalogEfforts(connector, model).includes(effort)
  );
}
