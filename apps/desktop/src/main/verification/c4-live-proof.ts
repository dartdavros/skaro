import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function latestC4LiveProof(data: string, project: string, phase: string) {
  const root = join(data, 'verification');
  const matches = [];
  for (const name of await readdir(root)) {
    if (!name.startsWith('c4-coordination-')) continue;
    const file = join(root, name, 'proof.json');
    const raw = await readFile(file, 'utf8').catch(() => undefined);
    if (!raw) continue;
    const proof = JSON.parse(raw);
    if (proof.passed && proof.projectId === project && proof.phase === phase)
      matches.push({ file, proof, time: (await stat(file)).mtimeMs });
  }
  matches.sort((a, b) => b.time - a.time);
  assert(matches[0], `A successful real ${phase} proof is required`);
  return matches[0];
}
