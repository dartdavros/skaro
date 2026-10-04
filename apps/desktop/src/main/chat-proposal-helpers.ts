import { type Task } from '@skaro/core';
import type { ProposedTaskArgs } from '@skaro/mcp-server';
import { type Proposal } from '@skaro/timeline';
import type { ProjectContext } from './projects';

export async function currentDoc(
  context: ProjectContext,
  path: string,
): Promise<string | undefined> {
  const artifacts = await context.load();
  const full = `.skaro/${path}`;
  const doc = [artifacts.brief, artifacts.architecture, ...artifacts.docs].find(
    (d) => d?.path === full,
  );
  return doc?.body;
}

export function sameText(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.replace(/\s+$/, '') === b.replace(/\s+$/, '');
}

export function adrId(value: string): string {
  const digits = /(\d+)/.exec(value)?.[1] ?? value;
  return digits.padStart(4, '0');
}

export function nextNumber(ids: string[], pattern: RegExp): number {
  let max = 0;
  for (const id of ids) max = Math.max(max, Number(pattern.exec(id)?.[1] ?? 0));
  return max + 1;
}

export function findCycle(tasks: ProposedTaskArgs[]): string[] | undefined {
  const deps = new Map(tasks.map((t) => [t.ref, t.dependsOn]));
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (ref: string): string[] | undefined => {
    if (state.get(ref) === 'done') return undefined;
    if (state.get(ref) === 'open') return [...path.slice(path.indexOf(ref)), ref];
    state.set(ref, 'open');
    path.push(ref);
    for (const dep of deps.get(ref) ?? []) {
      if (!deps.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(ref, 'done');
    return undefined;
  };
  for (const task of tasks) {
    const cycle = visit(task.ref);
    if (cycle) return cycle;
  }
  return undefined;
}

export function taskText(task: Pick<Task, 'title' | 'milestone' | 'dependsOn' | 'body'>): string {
  return [
    `# ${task.title}`,
    '',
    ...(task.milestone ? [`milestone: ${task.milestone}`] : []),
    ...(task.dependsOn.length ? [`depends_on: ${task.dependsOn.join(', ')}`] : []),
    '',
    task.body.trim(),
    '',
  ].join('\n');
}

export function describe(proposal: Proposal): string {
  switch (proposal.type) {
    case 'doc':
      return `the change to .skaro/${proposal.path}`;
    case 'adr':
      return `ADR "${proposal.title}"`;
    case 'spec':
      return `specification "${proposal.title}"`;
    case 'spec_change':
      return `the change to SPEC-${proposal.id} "${proposal.title}"`;
    case 'import':
      return 'the import of documentation';
    case 'plan':
      return proposal.milestone?.isNew
        ? `milestone "${proposal.milestone.title}" and its ${proposal.tasks.length} tasks`
        : `the ${proposal.tasks.length} proposed tasks (${proposal.tasks.map((t) => `"${t.title}"`).join(', ')})`;
    case 'task':
      return `the change to ${proposal.id} "${proposal.title}"`;
  }
}
