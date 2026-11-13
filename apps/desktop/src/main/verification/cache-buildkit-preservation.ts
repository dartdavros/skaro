import assert from 'node:assert/strict';
import type { ManagedBuilder } from '../managed-cache-store';
import type { ManagedDockerClient } from '../managed-docker-client';
import { managedCacheCommand } from '../managed-cache-command';
import { observedDockerEnvironment } from '../managed-docker-observation';
import { builderVolumeName } from '../managed-buildkit-policy';
import { resourceInventory } from './resource-workflow-observation';
import { cacheBuildkitHash } from './cache-buildkit-contract';

type Inventory = Awaited<ReturnType<typeof resourceInventory>>;
/** Snapshot existing Docker objects themselves, not just their names. No writes or Docker config copies. */
export async function existingBuildkitObjects(
  cwd: string,
  inventory: Inventory,
  client?: ManagedDockerClient,
) {
  const result: Record<string, string> = {};
  for (const [kind, values] of [
    ['container', inventory.containers],
    ['volume', inventory.volumes],
    ['image', inventory.images],
    ['network', inventory.networks],
  ] as const) {
    const ids = [...new Set(values.filter(Boolean))];
    // Bounded native multi-object inspect avoids hundreds of supervised CLI startups.
    // Hash each original one-element response shape to preserve existing proof compatibility.
    for (let offset = 0; offset < ids.length; offset += 16) {
      const batch = ids.slice(offset, offset + 16);
      const value: unknown = JSON.parse(
        await managedCacheCommand(client?.docker ?? 'docker', [kind, 'inspect', ...batch], {
          cwd,
          env: observedDockerEnvironment(client),
          maxOutput: 4 * 1024 ** 2,
        }),
      );
      assert(Array.isArray(value) && value.length === batch.length);
      for (const id of batch) {
        const matches: unknown[] = value.filter((item: unknown) => {
          if (!item || typeof item !== 'object') return false;
          const object = item as Record<string, unknown>;
          return (kind === 'volume' ? object.Name : object.Id) === id;
        });
        assert.equal(matches.length, 1, 'Exact Docker inspect identity required');
        result[`${kind}:${id}`] = cacheBuildkitHash(matches);
      }
    }
  }
  return result;
}
export function requireBuildkitInventory(
  before: Inventory,
  after: Inventory,
  owned?: ManagedBuilder,
) {
  assert.equal(after.worktrees, before.worktrees);
  const additions: Record<'containers' | 'volumes' | 'images' | 'networks', string[]> = {
    containers: owned?.container ? [owned.container] : [],
    volumes: owned ? [builderVolumeName(owned)] : [],
    images: owned ? [owned.image] : [],
    networks: [],
  };
  for (const kind of ['containers', 'volumes', 'images', 'networks'] as const) {
    for (const id of before[kind].filter(Boolean))
      assert(after[kind].includes(id), `Existing ${kind} disappeared`);
    for (const id of after[kind].filter(Boolean))
      assert(
        before[kind].includes(id) || additions[kind].includes(id),
        `Unapproved ${kind} addition`,
      );
  }
}
