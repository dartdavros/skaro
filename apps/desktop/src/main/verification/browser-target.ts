import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Owner-selected real project from the existing registry; never create/seed a project. */
export async function catPilotTarget(dataDirectory: string, requested: string) {
  const db = new DatabaseSync(join(dataDirectory, 'skaro.db'), { readOnly: true });
  try {
    const rows = db
      .prepare('SELECT path FROM projects WHERE name = ? COLLATE NOCASE')
      .all('Cat-pilot') as { path: string }[];
    assert.equal(rows.length, 1, 'Exactly one registered Cat-pilot is required');
    const root = await realpath(rows[0]!.path);
    assert.equal(
      await realpath(resolve(requested)),
      root,
      'Browser acceptance must target registered Cat-pilot',
    );
    return { root, url: pathToFileURL(await realpath(join(root, 'index.html'))).href };
  } finally {
    db.close();
  }
}

export const CAT_PILOT_OBSERVATION = `() => {
  const stage = document.querySelector('#stage');
  const button = document.querySelector('button');
  if (document.title !== 'Кот-пилот' || !stage || !stage.getAttribute('aria-label')) throw new Error('Real Cat-pilot scene missing');
  const layers = ['sky','sun','hills','runway','fish-cloud','cat-walk','plane'];
  if (!layers.every(id => document.getElementById(id)) || document.querySelectorAll('.scene-cloud').length !== 7) throw new Error('Cat-pilot layers missing');
  if (performance.getEntriesByType('resource').some(entry => /^https?:/.test(entry.name))) throw new Error('Cat-pilot requested network resources');
  for (const animation of document.getAnimations()) {
    animation.pause();
    const duration = animation.effect.getTiming().duration;
    if (typeof duration === 'number') animation.currentTime = duration / 2;
  }
  return { url: location.href, title: document.title, layers, animationCount: document.getAnimations().length, buttonPresent: !!button, sampledPercent: 50, networkResources: 0 };
}`;
