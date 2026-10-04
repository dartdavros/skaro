import type { Adr, ArtifactProblem, Milestone, Spec, Task, TaskStatus } from './model.ts';
import { TASK_STATUSES } from './model.ts';

export function toTask(
  f: Record<string, unknown>,
  body: string,
  path: string,
  problems: ArtifactProblem[],
): Task | undefined {
  const id = str(f['id']);
  if (!id) {
    problems.push({ path, message: 'task without id' });
    return undefined;
  }
  let status = str(f['status']) as TaskStatus | undefined;
  if (!status || !TASK_STATUSES.includes(status)) {
    if (status) problems.push({ path, message: `unknown status "${status}"` });
    status = 'todo';
  }
  return {
    id,
    title: str(f['title']) ?? id,
    milestone: str(f['milestone']),
    status,
    dependsOn: strings(f['depends_on']),
    unblocked: f['unblocked'] === true,
    archived: f['archived'] === true,
    order: num(f['order']),
    agent: str(f['agent']),
    model: str(f['model']),
    branch: str(f['branch']),
    spec: specId(f['spec']),
    created: str(f['created']) ?? dateString(f['created']),
    body,
    path,
  };
}

export function toMilestone(
  f: Record<string, unknown>,
  body: string,
  path: string,
  problems: ArtifactProblem[],
): Milestone | undefined {
  const id = str(f['id']);
  if (!id) {
    problems.push({ path, message: 'milestone without id' });
    return undefined;
  }
  return {
    id,
    title: str(f['title']) ?? id,
    order: num(f['order']) ?? 0,
    branch: str(f['branch']),
    body,
    path,
  };
}

export function toAdr(
  f: Record<string, unknown>,
  body: string,
  path: string,
  problems: ArtifactProblem[],
): Adr | undefined {
  const id =
    str(f['id']) ?? (typeof f['id'] === 'number' ? String(f['id']).padStart(4, '0') : undefined);
  if (!id) {
    problems.push({ path, message: 'ADR without id' });
    return undefined;
  }
  const status = str(f['status']);
  return {
    id,
    title: str(f['title']) ?? id,
    status: status === 'accepted' || status === 'superseded' ? status : 'proposed',
    replaces: str(f['replaces']),
    replacedBy: str(f['replaced_by']),
    date: str(f['date']) ?? dateString(f['date']),
    body,
    path,
  };
}

export function toSpec(
  f: Record<string, unknown>,
  body: string,
  path: string,
  problems: ArtifactProblem[],
): Spec | undefined {
  const id = specId(f['id']);
  if (!id) {
    problems.push({ path, message: 'specification without id' });
    return undefined;
  }
  const status = str(f['status']);
  return {
    id,
    title: str(f['title']) ?? id,
    status: status === 'accepted' || status === 'superseded' ? status : 'proposed',
    replaces: specId(f['replaces']),
    replacedBy: specId(f['replaced_by']),
    date: str(f['date']) ?? dateString(f['date']),
    body,
    path,
  };
}

/** "0003", 3 (YAML number) or "SPEC-0003" as "0003". */
export function specId(value: unknown): string | undefined {
  const raw = typeof value === 'number' ? String(value) : str(value);
  const digits = raw ? /^(?:SPEC-)?(\d+)$/i.exec(raw.trim())?.[1] : undefined;
  return digits ? digits.padStart(4, '0') : undefined;
}

export function checkIds(
  kind: string,
  items: { id: string; path: string }[],
  problems: ArtifactProblem[],
): void {
  const seen = new Map<string, string>();
  for (const item of items) {
    const first = seen.get(item.id);
    if (first)
      problems.push({
        path: item.path,
        message: `duplicate ${kind} id ${item.id} (also in ${first})`,
      });
    else seen.set(item.id, item.path);
  }
}

export function nextNumber(ids: string[], pattern: RegExp): number {
  let max = 0;
  for (const id of ids) max = Math.max(max, Number(pattern.exec(id)?.[1] ?? 0));
  return max + 1;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((s) => s.trim());
  return [];
}

export function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** YAML turns `2026-09-18` into a Date. */
export function dateString(value: unknown): string | undefined {
  return value instanceof Date ? value.toISOString().slice(0, 10) : undefined;
}
