import { claudeDefinition } from '@skaro/adapter-claude/definition';
import { codexDefinition } from '@skaro/adapter-codex/definition';
import { skaroDefinition } from '@skaro/adapter-skaro/definition';
import type { AgentDefinition } from '@skaro/timeline';

/** The only registration site. Order is the existing UI order; runtime imports stay lazy. */
export const registrations = [claudeDefinition, codexDefinition, skaroDefinition] as const;

/** Contract-only entries have no UI or executable factories to expose. */
export const activeRegistrations = registrations.filter(
  (entry): entry is Extract<(typeof registrations)[number], AgentDefinition> =>
    'presentation' in entry,
);
