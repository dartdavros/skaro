import type { EnvironmentConfig } from '../artifacts/model.ts';

/** What a task environment is called and where its task works. */
export interface EnvironmentIdentity {
  /** Compose project and label value: lowercase, unique per task. */
  name: string;
  /** Main working copy of the project. */
  root: string;
  /** Checkout of the task. */
  worktree: string;
  /** Host port of every port variable. */
  ports: Record<string, number>;
}

/** "Chatballs" + "T-026" → "skaro-chatballs-t-026": a valid compose project name. */
export function environmentName(project: string, taskId: string): string {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return ['skaro', slug(project) || 'project', slug(taskId) || 'task'].join('-');
}

/** Fills {name}, {root}, {worktree} and {PORT_VARIABLE}; unknown placeholders stay as written. */
export function expand(template: string, identity: EnvironmentIdentity): string {
  const values: Record<string, string> = {
    name: identity.name,
    root: identity.root.replaceAll('\\', '/'),
    worktree: identity.worktree.replaceAll('\\', '/'),
    ...Object.fromEntries(Object.entries(identity.ports).map(([k, v]) => [k, String(v)])),
  };
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, key: string) =>
    Object.hasOwn(values, key) ? values[key]! : whole,
  );
}

/**
 * Variables of the environment's commands and of the agent's shell. With the same values in both,
 * `docker compose` run by the agent addresses the very project Skaro started.
 */
export function environmentVariables(
  identity: EnvironmentIdentity,
  config?: EnvironmentConfig,
): Record<string, string> {
  return {
    COMPOSE_PROJECT_NAME: identity.name,
    SKARO_ENV_NAME: identity.name,
    ...Object.fromEntries(Object.entries(identity.ports).map(([k, v]) => [k, String(v)])),
    ...Object.fromEntries(
      Object.entries(config?.env ?? {}).map(([k, v]) => [k, expand(v, identity)]),
    ),
  };
}
