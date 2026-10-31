import { claudeDefinition } from '@skaro/adapter-claude/definition';
import { codexDefinition } from '@skaro/adapter-codex/definition';

/** The only registration site. Order is the existing UI order; runtime imports stay lazy. */
export const registrations = [claudeDefinition, codexDefinition] as const;
