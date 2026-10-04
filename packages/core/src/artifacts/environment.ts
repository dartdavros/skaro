import type { ArtifactProblem, EnvironmentConfig } from './model.ts';

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BUILT_IN = ['name', 'root', 'worktree'];
/** Skaro sets these itself; a project value would detach the environment from its task. */
const RESERVED = ['COMPOSE_PROJECT_NAME', 'SKARO_ENV_NAME'];

/** Placeholders of a template: {name}, {root}, {worktree} and port variables. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]!);
}

/** A broken description must stop the environment, not start a half-configured one. */
export function readEnvironment(
  raw: unknown,
  problems: ArtifactProblem[],
): EnvironmentConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  const fail = (message: string): undefined => {
    problems.push({ path: '.skaro/config.yaml', message: `environment: ${message}` });
    return undefined;
  };
  if (typeof raw !== 'object' || Array.isArray(raw)) return fail('must be a mapping');
  const section = raw as Record<string, unknown>;
  const ports = section['ports'] ?? [];
  if (!Array.isArray(ports) || ports.some((p) => typeof p !== 'string' || !VARIABLE.test(p)))
    return fail('ports must be a list of variable names');
  const map = (key: string): Record<string, string> | undefined => {
    const value = section[key] ?? {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.some(([name, text]) => !VARIABLE.test(name) || typeof text !== 'string'))
      return undefined;
    return Object.fromEntries(entries) as Record<string, string>;
  };
  const env = map('env');
  const urls = map('urls');
  if (!env) return fail('env must map variable names to strings');
  if (!urls) return fail('urls must map names to addresses');
  const reserved = [...ports, ...Object.keys(env)].find((name) => RESERVED.includes(name));
  if (reserved) return fail(`${reserved} is set by Skaro`);
  const command = (key: string): string | undefined => {
    const value = section[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  const start = command('start');
  if (!start) return fail('start must be a command');
  const config: EnvironmentConfig = {
    ports: ports as string[],
    env,
    ...(command('create') ? { create: command('create')! } : {}),
    start,
    ...(command('ready') ? { ready: command('ready')! } : {}),
    urls,
  };
  const known = new Set([...BUILT_IN, ...config.ports]);
  const texts = [
    config.create,
    config.start,
    config.ready,
    ...Object.values(env),
    ...Object.values(urls),
  ];
  const unknown = texts.flatMap((text) => placeholders(text ?? '')).find((p) => !known.has(p));
  if (unknown) return fail(`unknown placeholder {${unknown}}`);
  return config;
}

/** The section as config.yaml stores it. */
export function environmentYaml(config: EnvironmentConfig | undefined): unknown {
  if (!config) return undefined;
  return {
    ports: config.ports.length ? config.ports : undefined,
    env: Object.keys(config.env).length ? config.env : undefined,
    create: config.create,
    start: config.start,
    ready: config.ready,
    urls: Object.keys(config.urls).length ? config.urls : undefined,
  };
}
