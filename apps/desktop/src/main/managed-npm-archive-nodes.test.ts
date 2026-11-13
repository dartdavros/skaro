import { expect, it } from 'vitest';
import { NpmArchiveNodes } from './managed-npm-archive-nodes';
import { NPM_INSTALL_FILE_LIMIT } from './managed-npm-archive';

const error = 'managed_dependencies_unsupported_archive_expansion';

it('counts shared payload parents once, with one stripped package root', () => {
  const nodes = new NpmArchiveNodes(NPM_INSTALL_FILE_LIMIT);
  expect(
    nodes.add({ root: 'package', path: 'package/helpers/esm/extends.js', directory: false }),
  ).toEqual({ nodes: 4, delta: 4 });
  expect(
    nodes.add({
      root: 'package',
      path: 'package/helpers/esm/asyncToGenerator.js',
      directory: false,
    }),
  ).toEqual({ nodes: 5, delta: 1 });
  expect(
    nodes.add({ root: 'package', path: 'package/helpers/extends.js', directory: false }),
  ).toEqual({ nodes: 6, delta: 1 });
  expect(nodes.add({ root: 'package', path: 'package/helpers/', directory: true })).toEqual({
    nodes: 6,
    delta: 0,
  });
  expect(nodes.add({ root: 'package', path: 'package/helpers/esm', directory: true })).toEqual({
    nodes: 6,
    delta: 0,
  });
  expect(nodes.add({ root: 'package', path: 'package/', directory: true })).toEqual({
    nodes: 6,
    delta: 0,
  });
  expect(() => nodes.add({ root: 'package', path: 'package', directory: true })).toThrow(error);
});

it('uses the actual header classification, including directories without slash suffixes', () => {
  const nodes = new NpmArchiveNodes(4);
  expect(nodes.add({ root: 'node', path: 'node/stream', directory: true })).toEqual({
    nodes: 2,
    delta: 2,
  });
  expect(nodes.add({ root: 'node', path: 'node/stream/web.d.ts', directory: false })).toEqual({
    nodes: 3,
    delta: 1,
  });
  expect(() => nodes.add({ root: 'node', path: 'node/compatibility/', directory: false })).toThrow(
    error,
  );
  expect(nodes.size).toBe(3);
});

it('rejects duplicates and case aliases of explicit entries and implied parents', () => {
  for (const second of [
    'package/helpers/esm/extends.js',
    'package/Helpers/esm/other.js',
    'package/helpers/ESM/other.js',
  ]) {
    const nodes = new NpmArchiveNodes(10);
    nodes.add({ root: 'package', path: 'package/helpers/esm/extends.js', directory: false });
    expect(() => nodes.add({ root: 'package', path: second, directory: false })).toThrow(error);
    expect(nodes.size).toBe(4);
  }
});

it('rejects file-as-parent and implied-directory-to-file changes without partial additions', () => {
  const file = new NpmArchiveNodes(10);
  file.add({ root: 'package', path: 'package/helpers', directory: false });
  expect(() =>
    file.add({ root: 'package', path: 'package/helpers/extends.js', directory: false }),
  ).toThrow(error);
  expect(file.size).toBe(2);
  const directory = new NpmArchiveNodes(10);
  directory.add({ root: 'package', path: 'package/helpers/extends.js', directory: false });
  expect(() =>
    directory.add({ root: 'package', path: 'package/helpers', directory: false }),
  ).toThrow(error);
  expect(directory.size).toBe(3);
});

it('enforces the exact node boundary but allows one later explicit declaration of an implied dir', () => {
  const nodes = new NpmArchiveNodes(4);
  nodes.add({ root: 'package', path: 'package/helpers/extends.js', directory: false });
  expect(
    nodes.add({ root: 'package', path: 'package/helpers/asyncToGenerator.js', directory: false }),
  ).toEqual({ nodes: 4, delta: 1 });
  expect(nodes.add({ root: 'package', path: 'package/helpers', directory: true })).toEqual({
    nodes: 4,
    delta: 0,
  });
  expect(() =>
    nodes.add({ root: 'package', path: 'package/helpers/other.js', directory: false }),
  ).toThrow(error);
  expect(() => nodes.add({ root: 'package', path: 'package/helpers/', directory: true })).toThrow(
    error,
  );
  expect(nodes.size).toBe(4);
});

it('does not select a root on failed admission, and returns detached inventory', () => {
  const nodes = new NpmArchiveNodes(1);
  expect(() =>
    nodes.add({ root: 'package', path: 'package/package.json', directory: false }),
  ).toThrow(error);
  expect(nodes.size).toBe(0);
  nodes.add({ root: 'node', path: 'node/', directory: true });
  expect(() => nodes.add({ root: 'package', path: 'package/', directory: true })).toThrow(error);
  const inventory = nodes.inventory();
  expect(inventory).toEqual([{ path: '', directory: true }]);
  expect(inventory[0]).not.toBe(nodes.inventory()[0]);
});

it('rejects invalid limits and incoherent validated-header metadata', () => {
  for (const limit of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    expect(() => new NpmArchiveNodes(limit)).toThrow(error);
  for (const path of [
    'different/package.json',
    'package//package.json',
    'package/../package.json',
    'package',
  ])
    expect(() => new NpmArchiveNodes(4).add({ root: 'package', path, directory: false })).toThrow(
      error,
    );
});
