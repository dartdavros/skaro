import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImportKind } from '@skaro/timeline';
import type { ImportState, Manifest, StagedArtifact, StagedType } from './import-model';

// ── import state on disk ─────────────────────────────────────────────────────

export async function saveState(state: ImportState): Promise<void> {
  await mkdir(state.dir, { recursive: true });
  await writeFile(join(state.dir, 'state.json'), JSON.stringify(state, null, 2));
}

export async function loadState(dir: string): Promise<ImportState | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) as ImportState;
  } catch {
    return undefined;
  }
}

export async function loadManifest(dir: string): Promise<Manifest | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  } catch {
    return undefined;
  }
}

/** The copy and the staged artifacts go once the import is decided. */
export async function removeImport(dir: string): Promise<void> {
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
}

// ── what the review screen and the card show ─────────────────────────────────

/** "Бриф", "4 ADR", "2 этапа · 6 задач": a line per kind, in the review screen's order. */
export function importGroups(
  staged: StagedArtifact[],
): { kind: ImportKind; count: number; tasks?: number; updates: number }[] {
  const of = (types: StagedType[]) => staged.filter((s) => types.includes(s.type));
  const groups: { kind: ImportKind; count: number; tasks?: number; updates: number }[] = [];
  for (const kind of ['brief', 'architecture', 'adr', 'spec', 'doc'] as const) {
    const items = of([kind]);
    if (items.length) {
      groups.push({ kind, count: items.length, updates: items.filter((s) => s.updates).length });
    }
  }
  const milestones = of(['milestone']);
  const tasks = of(['task']);
  if (milestones.length || tasks.length) {
    groups.push({
      kind: 'plan',
      count: milestones.length,
      tasks: tasks.length,
      updates: 0,
    });
  }
  return groups;
}
