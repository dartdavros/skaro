import type { ArtifactFiles } from './files.ts';
import { toTask, toMilestone, toAdr, toSpec, checkIds } from './conversion.ts';
import { readConfig } from './config.ts';
import type { ArtifactProblem, Doc, ProjectArtifacts, ConfigDefaults } from './model.ts';
import { withC4Lock } from '../c4/io.ts';
import { recoverC4Transaction } from '../c4/transaction.ts';
import { inspectC4Project } from '../c4/project.ts';

export async function load(
  files: ArtifactFiles,
  defaults: () => ConfigDefaults,
  summary = false,
  includeC4 = !summary,
): Promise<ProjectArtifacts> {
  if (!includeC4) return loadProject(files, defaults, summary, false);
  return withC4Lock(files.root, async () => {
    await recoverC4Transaction(files.root);
    return loadProject(files, defaults, summary, true);
  });
}

async function loadProject(
  files: ArtifactFiles,
  defaults: () => ConfigDefaults,
  summary: boolean,
  includeC4: boolean,
): Promise<ProjectArtifacts> {
  const problems: ArtifactProblem[] = [];
  const config = await readConfig(files, defaults, problems);
  const brief = await files.readDoc('brief.md', 'brief', problems, !summary);
  const architecture = await files.readDoc('architecture.md', 'architecture', problems, !summary);
  const docs: Doc[] = [];
  for (const name of await files.list('docs')) {
    const doc = await files.readDoc(`docs/${name}`, 'doc', problems, !summary);
    if (doc) docs.push(doc);
  }
  const adrs = (await files.readAll('adr', problems, toAdr, !summary)).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const specs = (await files.readAll('specs', problems, toSpec, !summary)).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const milestones = (await files.readAll('milestones', problems, toMilestone)).sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
  const tasks = (await files.readAll('tasks', problems, toTask)).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  checkIds('task', tasks, problems);
  checkIds('milestone', milestones, problems);
  const taskIds = new Set(tasks.map((t) => t.id));
  const milestoneIds = new Set(milestones.map((m) => m.id));
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!taskIds.has(dep))
        problems.push({ path: task.path, message: `unknown dependency ${dep}` });
    }
    if (task.milestone && !milestoneIds.has(task.milestone)) {
      problems.push({ path: task.path, message: `unknown milestone ${task.milestone}` });
    }
    if (task.spec && !specs.some((s) => s.id === task.spec)) {
      problems.push({ path: task.path, message: `unknown specification ${task.spec}` });
    }
  }
  const c4 = includeC4 ? await inspectC4Project(files.root) : { problems: [] };
  return {
    config,
    brief,
    architecture,
    docs,
    adrs,
    specs,
    milestones,
    tasks,
    problems,
    ...(c4.model ? { c4: c4.model } : {}),
    c4Problems: c4.problems,
  };
}
