import { createHash } from 'node:crypto';

/** Explicit host environment only. Never inherits authentication variables from main/runtime. */
export function taskCommandEnvironment(input?: Readonly<Record<string, string>>) {
  if (input === undefined) return undefined;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length > 256
  )
    throw new Error('Invalid task command environment');
  const seen = new Set<string>();
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    const key = name.toUpperCase();
    if (
      !/^[A-Za-z_][A-Za-z0-9_]{0,199}$/.test(name) ||
      seen.has(key) ||
      [
        'NODE_OPTIONS',
        'NODE_PATH',
        'ELECTRON_RUN_AS_NODE',
        'SKARO_COMMAND_NODE',
        'SKARO_COMMAND_ENTRY',
        '__PROTO__',
        'CONSTRUCTOR',
        'PROTOTYPE',
      ].includes(key) ||
      typeof value !== 'string' ||
      value.includes('\0')
    )
      throw new Error('Unsafe task command environment');
    seen.add(key);
    result[name] = value;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 131_072)
    throw new Error('Task command environment exceeds limit');
  return result;
}

export function taskCommandEnvironmentRevision(input?: Readonly<Record<string, string>>) {
  const values = taskCommandEnvironment(input);
  return values === undefined
    ? undefined
    : createHash('sha256')
        .update(JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))))
        .digest('hex');
}

export function requireTaskCommandEnvironment(
  input: Readonly<Record<string, string>> | undefined,
  revision?: string,
) {
  if (taskCommandEnvironmentRevision(input) !== revision)
    throw new Error('Task command environment differs from host policy');
  return taskCommandEnvironment(input);
}
