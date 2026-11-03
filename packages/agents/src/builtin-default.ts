import type { AgentId } from './index.ts';
import { activeRegistrations } from './registrations.ts';

/** Release gate remains closed until BA-1–BA-9 acceptance and the owner's release decision. */
export const BUILTIN_DEFAULT_RELEASED = false;
/** Product entry points stay disabled while Skaro is marked as in development. */
export const BUILTIN_PRODUCT_RELEASED = false;
export function newSettingsAgent(
  saved: AgentId | undefined,
  accepted = BUILTIN_DEFAULT_RELEASED,
): AgentId {
  if (saved !== undefined) return saved;
  return accepted ? 'skaro' : activeRegistrations[0]!.presentation.id;
}
