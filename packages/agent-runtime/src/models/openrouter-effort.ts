import type { OpenRouterCatalogEntry } from './openrouter-catalog.ts';

/** OpenRouter wire values supported by this connector; no model/manufacturer inference. */
export const OPENROUTER_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export function openRouterEfforts(model?: Pick<OpenRouterCatalogEntry, 'reasoning'>): string[] {
  const reasoning = model?.reasoning;
  if (!reasoning || reasoning.supportedEfforts === undefined) return [];
  const advertised = reasoning.supportedEfforts ?? OPENROUTER_EFFORTS;
  return OPENROUTER_EFFORTS.filter(
    (value) => advertised.includes(value) && !(value === 'none' && reasoning.mandatory === true),
  );
}
