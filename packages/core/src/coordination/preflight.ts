import { isAbsolute } from 'node:path';
import type { Task } from '../artifacts/model.ts';

export interface WorkflowInput {
  kind: 'artifact' | 'service';
  id: string;
  phase: 'prerequisite' | 'result';
  producedBy?: string;
  /** Artifact: project-relative path and required content SHA256. Service: local readiness URL. */
  path?: string;
  sha256?: string;
  url?: string;
}
export type ProjectWorkflow = Record<string, WorkflowInput[]>;

export function parseProjectWorkflow(raw: unknown): ProjectWorkflow | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('workflow must map task IDs to input lists');
  const result: ProjectWorkflow = {};
  for (const [task, values] of Object.entries(raw)) {
    if (!/^T-\d+$/.test(task) || !Array.isArray(values))
      throw new Error('Invalid workflow task inputs');
    result[task] = values.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid workflow input');
      const v = value as Record<string, unknown>;
      if (
        Object.keys(v).some(
          (k) => !['kind', 'id', 'phase', 'producedBy', 'path', 'sha256', 'url'].includes(k),
        ) ||
        typeof v.id !== 'string' ||
        !v.id.trim() ||
        !['artifact', 'service'].includes(String(v.kind)) ||
        !['prerequisite', 'result'].includes(String(v.phase)) ||
        (v.producedBy !== undefined &&
          (typeof v.producedBy !== 'string' || !/^T-\d+$/.test(v.producedBy)))
      )
        throw new Error('Invalid workflow input identity or phase');
      if (v.kind === 'artifact') {
        if (
          typeof v.path !== 'string' ||
          !v.path ||
          isAbsolute(v.path) ||
          v.path.split(/[\\/]/).includes('..') ||
          typeof v.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(v.sha256) ||
          v.url !== undefined
        )
          throw new Error('Artifact input requires a relative path and exact SHA256');
      } else {
        if (typeof v.url !== 'string' || v.path !== undefined || v.sha256 !== undefined)
          throw new Error('Service input requires a readiness URL');
        const url = new URL(v.url);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
          url.username ||
          url.password
        )
          throw new Error('Service preflight requires a local URL without credentials');
      }
      return { ...v } as unknown as WorkflowInput;
    });
    if (new Set(result[task].map((v) => v.id)).size !== result[task].length)
      throw new Error('Duplicate workflow input');
  }
  return result;
}

/** A future output is never a prerequisite; code edges and declared producer edges share one DAG. */
export function assertWorkflowGraph(
  tasks: readonly Task[],
  workflow: ProjectWorkflow = {},
  taskId: string,
): void {
  const index = new Map(tasks.map((t) => [t.id, t]));
  const visiting: string[] = [],
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.includes(id))
      throw new Error(
        `Dependency cycle: ${[...visiting.slice(visiting.indexOf(id)), id].join(' -> ')}`,
      );
    if (visited.has(id)) return;
    const task = index.get(id);
    if (!task) throw new Error(`Missing code dependency: ${id}`);
    visiting.push(id);
    const edges = new Set(task.dependsOn);
    for (const input of workflow[id] ?? []) {
      if (input.phase === 'result') continue;
      if (input.producedBy === id)
        throw new Error(
          `${id}: prerequisite ${input.id} is a future result of this task; classify it as result`,
        );
      if (input.producedBy) edges.add(input.producedBy);
    }
    for (const edge of edges) visit(edge);
    visiting.pop();
    visited.add(id);
  };
  visit(taskId);
}
