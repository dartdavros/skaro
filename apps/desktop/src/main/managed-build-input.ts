import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { ManagedBuilder, ManagedCacheStore } from './managed-cache-store';
import { CacheRemovalPlan } from './managed-cache-removal-plan';
import { cacheTree } from './managed-cache-files';
import { managedContextDigest } from './managed-build-context';
import type { ManagedBuildSource } from './managed-build-source';
import { resourceExecution } from './resource-execution';

type Tree = Awaited<ReturnType<typeof cacheTree>>;
export interface PreparedManagedBuildInput {
  readonly kind: 'verified-managed-build-input';
}
interface Input {
  projectId: string;
  resourceId: string;
  generation: number;
  intentId: string;
  sourceDigest: string;
  cwd: string;
  context: string;
  snapshotDigest: string;
  observation: Tree;
  verifyProducer(): Promise<void>;
  consumed: boolean;
}
const inputs = new WeakMap<PreparedManagedBuildInput, Input>();

/** Compare real frozen bytes to the approved source, never to a fabricated Git index in the copy. */
export function frozenManagedBuildDigest(tree: Tree, source: ManagedBuildSource) {
  assert.equal(tree.files.length, source.entries.length);
  assert.equal(tree.bytes, source.bytes);
  assert.equal(tree.nodes.size, source.nodes + 1);
  const files = new Map(tree.files.map((file) => [file.path, file]));
  const root = tree.nodes.keys().next().value!;
  return managedContextDigest(
    source.entries.map((expected) => {
      const actual = files.get(expected.path);
      assert(actual && actual.digest === expected.digest && actual.bytes === expected.bytes);
      const native = tree.nodes.get(join(root, ...expected.path.split('/')))?.native;
      assert(native && native.isFile());
      return {
        path: actual.path,
        mode: Number(native.mode & 0o777n),
        bytes: actual.bytes,
        digest: actual.digest,
      };
    }),
  );
}

async function requireInput(store: ManagedCacheStore, input: Input) {
  await input.verifyProducer();
  const current = await cacheTree(store.root, input.context, input.observation.bytes);
  assert.equal(current.digest, input.observation.digest);
  assert.equal(current.nodes.size, input.observation.nodes.size);
  const plan = new CacheRemovalPlan(input.context, input.observation);
  for (const [path, node] of current.nodes) {
    plan.assertNative(path, node.native);
    if (node.children) plan.assertChildren(path, node.children);
  }
}

/** Host closure callback + real source/native observations issue a non-serializable, single-use input. */
export async function prepareManagedBuildInput(
  store: ManagedCacheStore,
  entry: ManagedBuilder,
  cwd: string,
  source: ManagedBuildSource,
  verifyProducer: () => Promise<void>,
): Promise<PreparedManagedBuildInput> {
  const scope = resourceExecution.getStore();
  assert(scope?.resources && scope.projectId === entry.projectId);
  await scope.requireCurrent();
  await verifyProducer();
  const context = join(store.builderPath(entry.projectId), 'context');
  const observation = await cacheTree(store.root, context, source.bytes);
  const input: Input = {
    projectId: entry.projectId,
    resourceId: entry.resourceId,
    generation: entry.generation,
    intentId: scope.intentId,
    sourceDigest: source.sourceDigest,
    cwd,
    context,
    snapshotDigest: frozenManagedBuildDigest(observation, source),
    observation,
    verifyProducer,
    consumed: false,
  };
  await requireInput(store, input);
  const capability: PreparedManagedBuildInput = Object.freeze({
    kind: 'verified-managed-build-input',
  });
  inputs.set(capability, input);
  return capability;
}

/** A receipt/JSON object supplies no authority. Consumption requires this attempt's fresh live build grant. */
export async function consumeManagedBuildInput(
  capability: PreparedManagedBuildInput,
  store: ManagedCacheStore,
  entry: ManagedBuilder,
  cwd: string,
  source: ManagedBuildSource,
) {
  const input = inputs.get(capability),
    scope = resourceExecution.getStore(),
    held = scope?.cacheAuthority;
  assert(held);
  assert(input && !input.consumed && held.isLive?.());
  assert(scope?.ownerId === 'managed-cache:buildkit' && scope.intentId === input.intentId);
  assert.equal(entry.projectId, input.projectId);
  assert.equal(entry.resourceId, input.resourceId);
  assert.equal(entry.generation, input.generation);
  assert.equal(cwd, input.cwd);
  assert.equal(source.sourceDigest, input.sourceDigest);
  assert(
    held.lease.locks.some(
      (lock) =>
        lock.resourceId === entry.resourceId &&
        lock.generation === entry.generation &&
        lock.mode === 'exclusive',
    ),
  );
  await scope.requireCurrent();
  await requireInput(store, input);
  input.consumed = true;
  return {
    snapshotDigest: input.snapshotDigest,
    contextDigest: input.observation.digest,
    observation: input.observation,
  };
}
