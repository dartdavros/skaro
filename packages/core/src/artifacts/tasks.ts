import type { ArtifactFiles } from './files.ts';
import { toTask, nextNumber } from './conversion.ts';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task } from './model.ts';
import type { NewTask, TaskPatch } from './inputs.ts';
import { parseMarkdown, serializeMarkdown, setFields } from './frontmatter.ts';
import { slugify } from './slug.ts';

export async function readTask(files: ArtifactFiles, id: string): Promise<Task> {
  return (await files.findFile('tasks', id, toTask)).item;
}

export async function createTask(files: ArtifactFiles, input: NewTask): Promise<Task> {
  const existing = await files.readAll('tasks', [], toTask);
  const id = `T-${String(
    nextNumber(
      existing.map((t) => t.id),
      /^T-(\d+)$/,
    ),
  ).padStart(3, '0')}`;
  const path = `tasks/${id}-${slugify(input.title)}.md`;
  const file = parseMarkdown('');
  setFields(file, {
    id,
    title: input.title,
    milestone: input.milestone,
    status: 'todo',
    depends_on: input.dependsOn ?? [],
    order: input.order,
    agent: input.agent,
    model: input.model,
    spec: input.spec,
    created: input.created ?? new Date().toISOString().slice(0, 10),
  });
  file.body = input.body ?? '## Цель\n\n## Критерии приёмки\n';
  await files.writeFile(path, serializeMarkdown(file));
  return readTask(files, id);
}

export async function updateTask(
  files: ArtifactFiles,
  id: string,
  patch: TaskPatch,
): Promise<Task> {
  const { file, path } = await files.findFile('tasks', id, toTask);
  setFields(file, {
    ...('title' in patch ? { title: patch.title } : {}),
    ...('milestone' in patch ? { milestone: patch.milestone } : {}),
    ...('status' in patch ? { status: patch.status } : {}),
    ...('dependsOn' in patch ? { depends_on: patch.dependsOn } : {}),
    // Flags are written only while set, so ordinary task files stay short.
    ...('unblocked' in patch ? { unblocked: patch.unblocked || undefined } : {}),
    ...('archived' in patch ? { archived: patch.archived || undefined } : {}),
    ...('order' in patch ? { order: patch.order } : {}),
    ...('agent' in patch ? { agent: patch.agent } : {}),
    ...('model' in patch ? { model: patch.model } : {}),
    ...('branch' in patch ? { branch: patch.branch } : {}),
    ...('spec' in patch ? { spec: patch.spec } : {}),
  });
  if (patch.body !== undefined) file.body = patch.body;
  await files.writeFile(path, serializeMarkdown(file));
  return readTask(files, id);
}

export async function deleteTask(files: ArtifactFiles, id: string): Promise<void> {
  const { path } = await files.findFile('tasks', id, toTask);
  await rm(join(files.dir, path));
  files.ownWrites.delete(join(files.dir, path));
  for (const task of await files.readAll('tasks', [], toTask)) {
    if (task.dependsOn.includes(id)) {
      await updateTask(files, task.id, { dependsOn: task.dependsOn.filter((d) => d !== id) });
    }
  }
}
