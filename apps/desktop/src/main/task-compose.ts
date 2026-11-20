import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { Document, YAMLSeq } from 'yaml';
import type { EnvironmentIdentity } from '@skaro/core';
import { assertManagedPorts, managedPortPlan, type ComposeModel } from './task-compose-ports';
import { composeSourceFiles } from './compose-source-files';
import { composePortVariables } from './task-compose-env';

export interface ManagedCompose {
  variables: Record<string, string>;
  baseVariables: Record<string, string>;
  override: string;
}

/** Stable service-owned path also reaches already attached agent shells through COMPOSE_FILE. */
export async function describeCompose(
  dataDir: string,
  identity: EnvironmentIdentity,
  variables: Record<string, string>,
): Promise<ManagedCompose | undefined> {
  if (!existsSync(identity.worktree)) return undefined;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(identity.name))
    throw new Error('Invalid managed Compose project name');
  const separator = variables.COMPOSE_PATH_SEPARATOR ?? delimiter;
  const files = composeSourceFiles(identity.worktree, variables);
  if (!variables.COMPOSE_FILE && !files.length) return undefined;
  const override = join(dataDir, 'environments', identity.name, 'ports.yaml');
  const base = files.filter((file) => file !== override);
  if (!base.length) throw new Error('Compose has no source files');
  await mkdir(dirname(override), { recursive: true });
  try {
    await writeFile(override, 'services: {}\n', { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const baseVariables = {
    ...(await composePortVariables(dirname(override), identity, variables)),
    COMPOSE_FILE: base.join(separator),
    COMPOSE_PATH_SEPARATOR: separator,
  };
  return {
    baseVariables,
    override,
    variables: { ...baseVariables, COMPOSE_FILE: [...base, override].join(separator) },
  };
}

/** Only read Docker's canonical model; secrets and resolved environment never reach disk or UI. */
export function readCompose(cwd: string, env: Record<string, string>): Promise<ComposeModel> {
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      ['compose', 'config', '--format', 'json', '--no-env-resolution'],
      {
        cwd,
        env: { ...process.env, ...env },
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error)
          return reject(
            new Error(`Compose port admission failed: ${String(stderr).trim() || error.message}`),
          );
        try {
          const model = JSON.parse(stdout) as ComposeModel;
          if (!model.services || typeof model.services !== 'object')
            throw new Error('Compose returned no services');
          resolve(model);
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

/** !override replaces the port list; ordinary Compose merging would retain the old bindings. */
export async function admitCompose(
  identity: EnvironmentIdentity,
  compose: ManagedCompose,
): Promise<Record<string, string>> {
  const model = await readCompose(identity.worktree, compose.baseVariables);
  const plan = managedPortPlan(model, identity.ports);
  const document = new Document({ services: plan.services });
  for (const service of Object.keys(plan.services)) {
    const sequence = document.getIn(['services', service, 'ports']);
    if (!(sequence instanceof YAMLSeq)) throw new Error('Invalid managed Compose ports');
    sequence.tag = '!override';
  }
  const next = document.toString();
  if ((await readFile(compose.override, 'utf8')) !== next) await writeFile(compose.override, next);
  assertManagedPorts(await readCompose(identity.worktree, compose.variables), identity.ports);
  return plan.endpoints;
}

export async function removeCompose(dataDir: string, name: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error('Invalid managed Compose project name');
  await rm(join(dataDir, 'environments', name, 'ports.yaml'), { force: true });
  await rm(join(dataDir, 'environments', name, 'ports.env'), { force: true });
}
