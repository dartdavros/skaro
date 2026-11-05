import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMap, parseDocument } from 'yaml';
import type { ArtifactFiles } from './files.ts';
import { environmentYaml, readEnvironment } from './environment.ts';
import type { ArtifactProblem } from './model.ts';
import { serializeConfig } from './config-queue.ts';

async function configText(files: ArtifactFiles): Promise<string | null> {
  try {
    return await readFile(join(files.dir, 'config.yaml'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Pure preparation preserves comments, unknown keys and inherited settings. */
export function prepareEnvironmentSetup(
  text: string | null,
  input?: {
    environment: unknown;
    expectedRevision: string;
  },
) {
  const revision = createHash('sha256').update(JSON.stringify(text)).digest('hex');
  const document = parseDocument(text ?? '');
  if (document.errors.length) throw new Error(document.errors.map((e) => e.message).join('\n'));
  if (document.contents !== null && !isMap(document.contents))
    throw new Error('Config must be a YAML mapping');
  const raw = document.toJS() as Record<string, unknown> | null;
  const problems: ArtifactProblem[] = [];
  const current = readEnvironment(raw?.['environment'], problems);
  if (problems.length) throw new Error(problems.map((p) => p.message).join('\n'));
  if (!input) return { revision, environment: current ?? null };
  if (input.expectedRevision !== revision)
    throw new Error('Project configuration changed. Read setup_environment again before saving.');
  if (current)
    throw new Error(
      'Project environment already exists. Use configure_environment for task overrides.',
    );
  if (
    !input.environment ||
    typeof input.environment !== 'object' ||
    Array.isArray(input.environment)
  )
    throw new Error('Environment must be a mapping');
  const section = input.environment as Record<string, unknown>;
  const unknown = Object.keys(section).find(
    (key) => !['start', 'create', 'ready', 'env', 'ports', 'urls', 'source'].includes(key),
  );
  if (unknown) throw new Error(`Unknown environment field: ${unknown}`);
  for (const key of ['create', 'ready']) {
    if (section[key] !== undefined && (typeof section[key] !== 'string' || !section[key].trim()))
      throw new Error(`environment: ${key} must be a non-empty string`);
  }
  const environment = readEnvironment(input.environment, problems);
  if (!environment)
    throw new Error(problems.map((p) => p.message).join('\n') || 'Environment is required');
  document.set('environment', environmentYaml(environment));
  return { revision, environment, content: document.toString() };
}

/** Only the service writes the initial project declaration; this never executes commands. */
export function setupEnvironment(
  files: ArtifactFiles,
  input?: {
    environment: unknown;
    expectedRevision: string;
  },
) {
  return serializeConfig(files, async () => {
    const before = await configText(files);
    const prepared = prepareEnvironmentSetup(before, input);
    if (prepared.content !== undefined) {
      if ((await configText(files)) !== before)
        throw new Error(
          'Project configuration changed. Read setup_environment again before saving.',
        );
      await files.writeCreatedFile('config.yaml', prepared.content);
      return prepareEnvironmentSetup(prepared.content);
    }
    return prepared;
  });
}
