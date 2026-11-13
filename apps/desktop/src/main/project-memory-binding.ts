import type { AppDb } from '@skaro/core';
import type { ProjectMemory } from './project-memory';
const memories = new WeakMap<AppDb, ProjectMemory>();
export function bindProjectMemory(db: AppDb, memory: ProjectMemory): void {
  if (memories.has(db)) throw new Error('Project memory already bound');
  memories.set(db, memory);
}
export function projectMemory(db: AppDb): ProjectMemory | undefined {
  return memories.get(db);
}
