import type { ArtifactFiles } from './files.ts';
import { toTask, toMilestone, nextNumber } from './conversion.ts';
import * as tasks from './tasks.ts';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Milestone } from './model.ts';
import { parseMarkdown, serializeMarkdown, setFields } from './frontmatter.ts';
import { slugify } from './slug.ts';

export async function createMilestone(
  files: ArtifactFiles,
  input: {
    title: string;
    body?: string;
    order?: number;
  },
): Promise<Milestone> {
  const existing = await files.readAll('milestones', [], toMilestone);
  const id = `M${String(
    nextNumber(
      existing.map((m) => m.id),
      /^M(\d+)$/,
    ),
  ).padStart(2, '0')}`;
  const order = input.order ?? Math.max(0, ...existing.map((m) => m.order)) + 1;
  const file = parseMarkdown('');
  setFields(file, { id, title: input.title, order });
  file.body = input.body ?? '## Цель\n\n## Критерий готовности\n';
  await files.writeFile(`milestones/${id}-${slugify(input.title)}.md`, serializeMarkdown(file));
  return (await files.findFile('milestones', id, toMilestone)).item;
}

export async function updateMilestone(
  files: ArtifactFiles,
  id: string,
  patch: Partial<Pick<Milestone, 'title' | 'order' | 'body' | 'branch'>>,
): Promise<Milestone> {
  const { file, path } = await files.findFile('milestones', id, toMilestone);
  setFields(file, {
    ...('title' in patch ? { title: patch.title } : {}),
    ...('order' in patch ? { order: patch.order } : {}),
    ...('branch' in patch ? { branch: patch.branch } : {}),
  });
  if (patch.body !== undefined) file.body = patch.body;
  await files.writeFile(path, serializeMarkdown(file));
  return (await files.findFile('milestones', id, toMilestone)).item;
}

export async function deleteMilestone(
  files: ArtifactFiles,
  id: string,
  moveTasksTo?: string,
): Promise<void> {
  const { path } = await files.findFile('milestones', id, toMilestone);
  for (const task of await files.readAll('tasks', [], toTask)) {
    if (task.milestone === id) await tasks.updateTask(files, task.id, { milestone: moveTasksTo });
  }
  await rm(join(files.dir, path));
}
