import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  git,
  resourceId,
  validateC4Impact,
  type AppDb,
  type C4Impact,
  type ResourceRecord,
  type RunRecord,
} from '@skaro/core';
import type { ProjectContext } from './projects';
import { c4ArchitectureHash, c4ChangeHash } from './c4-fingerprint';
import { readTaskC4Scope, type C4TaskScope } from './c4-task-scope';
import { memoryVersion, requireMemoryPath } from './project-memory-sources';
import { taskInputSnapshot, type TaskInputSnapshot } from './task-preflight-inputs';
import { localC4Scope } from './c4-preservation';

export interface C4ImpactOwner {
  projectId: string;
  taskId: string;
  runId: string;
}
export interface C4ImpactObservation {
  version: 1;
  impact: C4Impact;
  head: string;
  runHash: string;
  intent: number;
  resource: { id: string; generation: number; identityHash: string };
  inputs: TaskInputSnapshot;
  scope: C4TaskScope;
  architectureHash: string;
  /** Deleted/missing paths stay explicit; they are never reported as verified source files. */
  files: { path: string; hash: string | null }[];
}

export function assertC4ImpactRun(
  owner: C4ImpactOwner,
  run: RunRecord | undefined,
  latest: RunRecord | undefined,
): asserts run is RunRecord {
  if (
    !run ||
    run.projectId !== owner.projectId ||
    run.taskId !== owner.taskId ||
    run.id !== owner.runId ||
    run.retiredAt !== undefined ||
    latest?.id !== run.id
  )
    throw new Error('C4 observation requires the current registered task run');
}

export function assertC4ImpactResource(
  owner: C4ImpactOwner,
  checkout: string,
  inPlace: boolean,
  resource: ResourceRecord | undefined,
): asserts resource is ResourceRecord {
  if (
    !resource ||
    resource.kind !== 'worktree' ||
    resource.projectId !== owner.projectId ||
    resource.identity.path !== checkout ||
    resource.ownership !== 'registered' ||
    resource.purpose !== 'worktree' ||
    resource.state === 'released' ||
    resource.state === 'error' ||
    resource.owner.kind !== (inPlace ? 'project' : 'task') ||
    resource.owner.id !== (inPlace ? owner.projectId : owner.taskId)
  )
    throw new Error('C4 observation checkout has no current registered ownership');
}

/** Hash only existing files inside the canonical checkout; never persist file contents. */
export async function readC4ImpactSources(checkout: string, paths: readonly string[]) {
  const files: C4ImpactObservation['files'] = [];
  for (const path of [...new Set(paths)].sort()) {
    if (
      !path ||
      isAbsolute(path) ||
      /^(?:[a-z]:|\\)/i.test(path) ||
      path.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('C4 observation source must be a relative file path');
    try {
      const actual = await requireMemoryPath(checkout, path);
      if (!(await stat(actual)).isFile())
        throw new Error('C4 observation source is not a concrete file');
      const hash = createHash('sha256')
        .update(await readFile(actual))
        .digest('hex');
      if ((await requireMemoryPath(checkout, path)) !== actual)
        throw new Error('C4 observation source moved while reading');
      files.push({ path, hash });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      files.push({ path, hash: null });
    }
  }
  return files;
}

/** No worker-supplied checkout, hashes, check verdicts, or semantic booleans enter this API. */
export async function observeC4Impact(
  db: AppDb,
  context: ProjectContext,
  taskId: string,
  runId: string,
  options: { requireDispatchInputs?: boolean } = {},
): Promise<C4ImpactObservation> {
  const owner = { projectId: context.id, taskId, runId };
  const project = db.getProject(context.id);
  if (
    !project ||
    (db.shell.projectScope && db.shell.projectScope !== context.id) ||
    (await realpath(project.path)) !== (await realpath(context.root))
  )
    throw new Error('C4 observation project is outside registered scope');
  const run = db.getRun(runId);
  assertC4ImpactRun(owner, run, db.latestRun(context.id, taskId));
  const checkout = await realpath(run.worktree ?? context.root);
  const registered = db.resources.get(
    resourceId({ projectId: context.id, kind: 'worktree', identity: { path: checkout } }),
  );
  assertC4ImpactResource(owner, checkout, !run.worktree, registered);
  const canonicalGitPath = async (root: string, flag: string) =>
    realpath((await git(root, ['rev-parse', '--path-format=absolute', flag])).stdout.trim());
  if (
    (await canonicalGitPath(checkout, '--show-toplevel')) !== checkout ||
    (await canonicalGitPath(checkout, '--git-common-dir')) !==
      (await canonicalGitPath(context.root, '--git-common-dir'))
  )
    throw new Error('C4 observation checkout does not belong to the registered Git project');
  const artifacts = await context.store.load();
  const inputs = await taskInputSnapshot(db, context, artifacts, taskId);
  const saved = db.getSetting<TaskInputSnapshot | undefined>(
    `coordination.inputs.${runId}`,
    undefined,
    { strict: true },
  );
  if (options.requireDispatchInputs !== false && (!saved || saved.version !== inputs.version))
    throw new Error('C4 observation requires the current dispatched preflight inputs');
  const baseHead = (
    await git(checkout, ['rev-parse', '--verify', `${artifacts.config.baseBranch}^{commit}`])
  ).stdout.trim();
  const head = (await git(checkout, ['rev-parse', '--verify', 'HEAD^{commit}'])).stdout.trim();
  const scope = localC4Scope(
    await readTaskC4Scope(checkout, baseHead, artifacts, taskId),
    artifacts.c4,
  );
  const architectureHash = c4ArchitectureHash(artifacts, scope);
  const code = (artifacts.c4?.elements ?? [])
    .filter((element) => scope.elements.includes(element.id))
    .flatMap((element) => [...element.code, ...(element.planned?.code ?? [])]);
  const changeHash = await c4ChangeHash(checkout, baseHead);
  const files = await readC4ImpactSources(checkout, [...scope.files, ...code]);
  const scopeHash = memoryVersion({ scope, architectureHash });
  const impact: C4Impact = {
    version: 1,
    ...owner,
    checkout,
    baseHead,
    changeHash,
    scopeHash,
    expectedRevision: artifacts.c4?.revision ?? 0,
    requirements: scope.requirements,
    elements: scope.elements,
    relationships: scope.relationships,
    sources: files.flatMap(({ path, hash }) => (hash === null ? [] : [{ path, hash }])),
    checks: [
      {
        id: 'host.source-snapshot',
        fingerprint: memoryVersion({ changeHash, scopeHash, files }),
        outcome: 'passed',
      },
    ],
    // No discrepancies observed here is NOT a semantic alignment verdict.
    discrepancies: [],
  };
  validateC4Impact(impact);
  const observation: C4ImpactObservation = {
    version: 1,
    impact,
    head,
    runHash: memoryVersion(run),
    intent: db.getSetting(`execution.${runId}.intent`, 0, { strict: true }),
    resource: {
      id: registered.id,
      generation: registered.generation,
      identityHash: memoryVersion({ identity: registered.identity, owner: registered.owner }),
    },
    inputs,
    scope,
    architectureHash,
    files,
  };
  // Collection awaits I/O: reject changed identity/code/inputs instead of certifying a mixed snapshot.
  assertC4ImpactRun(owner, db.getRun(runId), db.latestRun(context.id, taskId));
  const currentResource = db.resources.get(registered.id);
  assertC4ImpactResource(owner, checkout, !run.worktree, currentResource);
  if (
    memoryVersion(db.getRun(runId)) !== observation.runHash ||
    currentResource.generation !== registered.generation ||
    observation.intent !== db.getSetting(`execution.${runId}.intent`, 0, { strict: true }) ||
    changeHash !== (await c4ChangeHash(checkout, baseHead)) ||
    head !== (await git(checkout, ['rev-parse', '--verify', 'HEAD^{commit}'])).stdout.trim() ||
    baseHead !==
      (
        await git(checkout, ['rev-parse', '--verify', `${artifacts.config.baseBranch}^{commit}`])
      ).stdout.trim() ||
    memoryVersion(files) !==
      memoryVersion(
        await readC4ImpactSources(
          checkout,
          files.map((f) => f.path),
        ),
      )
  )
    throw new Error('C4 observation changed during collection');
  const after = await context.store.load();
  if (
    inputs.version !== (await taskInputSnapshot(db, context, after, taskId)).version ||
    architectureHash !== c4ArchitectureHash(after, scope)
  )
    throw new Error('C4 observation accepted inputs changed during collection');
  return observation;
}
