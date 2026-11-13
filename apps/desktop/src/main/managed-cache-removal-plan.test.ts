import { expect, it } from 'vitest';
import type { BigIntStats } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { cacheTree } from './managed-cache-files';
import { CacheRemovalPlan } from './managed-cache-removal-plan';

// Existing repository bytes only. Metadata copies are mutated; no fixture, deletion or executor.
const root = resolve('.');
const target = join(root, 'packages/core/src/queue');
const observed = () => cacheTree(root, target);
const changed = (info: BigIntStats, patch: Partial<BigIntStats>): BigIntStats =>
  Object.assign(Object.create(info), patch);

it('binds native metadata, including a single-file root, without adopting a wrong target', async () => {
  const file = join(root, 'package.json');
  const tree = await cacheTree(root, file);
  const plan = new CacheRemovalPlan(file, tree);
  const info = tree.nodes.get(file)!.native;
  expect(plan.children(file)).toBeUndefined();
  expect(plan.digest(file)).toBe(tree.files[0]!.digest);
  expect(plan.lineage(file)).toEqual([file]);
  expect(() => plan.assertNative(file, info)).not.toThrow();
  for (const patch of [
    { ino: info.ino + 1n },
    { dev: info.dev + 1n },
    { birthtimeNs: info.birthtimeNs + 1n },
    { size: info.size + 1n },
    { mtimeNs: info.mtimeNs + 1n },
    { nlink: 2n },
  ])
    expect(() => plan.assertNative(file, changed(info, patch))).toThrow('inventory_changed');
  expect(() => new CacheRemovalPlan(join(root, 'other-file'), tree)).toThrow('inventory_changed');
  plan.removed(file);
  expect(() => plan.lineage(file)).toThrow('inventory_changed');
});

it('detaches input collections and permits only successful own shrinkage, not unknown children', async () => {
  const tree = await observed();
  const plan = new CacheRemovalPlan(target, tree);
  const children = [...tree.nodes.get(target)!.children!];
  const info = tree.nodes.get(target)!.native;
  expect(children.length).toBeGreaterThan(0);
  tree.nodes.get(target)!.children!.push('unknown-empty-directory');
  tree.nodes.clear();
  tree.files.length = 0;
  expect(plan.children(target)).toEqual(children);
  expect(() => plan.assertChildren(target, [...children, 'unknown-empty-directory'])).toThrow(
    'inventory_changed',
  );
  expect(() => plan.assertChildren(target, children.slice(1))).toThrow('inventory_changed');
  expect(() =>
    plan.assertNative(target, changed(info, { mtimeNs: info.mtimeNs + 1n, size: info.size + 1n })),
  ).not.toThrow();
  expect(() => plan.removed(target)).toThrow('inventory_changed');
  for (const name of children) {
    const path = join(target, name);
    expect(plan.lineage(path)).toEqual([target, path]);
    plan.removed(path); // Metadata transition only: no file is removed.
    expect(() => plan.removed(path)).toThrow('inventory_changed');
  }
  expect(plan.children(target)).toEqual([]);
  expect(() => plan.assertChildren(target, [])).not.toThrow();
  plan.removed(target);
});

it('rejects incomplete file/directory coverage without effects', async () => {
  const tree = await observed();
  const file = [...tree.nodes].find(([, node]) => node.info.isFile())![0];
  const missing = { ...tree, nodes: new Map(tree.nodes) };
  missing.nodes.delete(file);
  expect(() => new CacheRemovalPlan(target, missing)).toThrow('inventory_changed');
  const noDigest = { ...tree, files: tree.files.filter((item) => item.path !== basename(file)) };
  expect(() => new CacheRemovalPlan(target, noDigest)).toThrow('inventory_changed');
  const alias = { ...tree, nodes: new Map(tree.nodes) };
  alias.nodes.set(join(root, 'outside'), tree.nodes.get(file)!);
  expect(() => new CacheRemovalPlan(target, alias)).toThrow('inventory_changed');
});
