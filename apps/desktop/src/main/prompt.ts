// Instructions for the agent of a task (architecture.md 7, step 3): project rules, where the
// project context is, the task itself, summaries of finished dependencies, Skaro's workflow.

import type { ProjectArtifacts, Task } from '@skaro/core';
import { taskSections } from './task-body';

const LANGUAGES: Record<string, string> = { ru: 'Russian', en: 'English' };

export function taskInstructions(options: {
  task: Task;
  artifacts: ProjectArtifacts;
  cwd: string;
  branch?: string;
  locale: string;
}): string {
  const { task, artifacts, cwd, branch } = options;
  const language = LANGUAGES[options.locale] ?? 'English';
  const context = [
    artifacts.brief && '.skaro/brief.md (what the project is)',
    artifacts.architecture && '.skaro/architecture.md (architecture, rules and constraints)',
    artifacts.adrs.length && '.skaro/adr/ (architecture decisions)',
  ].filter(Boolean);
  const deps = task.dependsOn
    .map((id) => artifacts.tasks.find((t) => t.id === id))
    .filter((t): t is Task => t !== undefined)
    .map((t) => {
      const summary = taskSections(t.body).summary;
      return `- ${t.id} ${t.title}${summary ? `: ${summary.replace(/\s+/g, ' ')}` : ''}`;
    });

  const parts = [
    `You are working on task ${task.id} "${task.title}" in a project managed by Skaro.`,
    branch
      ? `Your working folder ${cwd} is a git worktree on branch ${branch}, made for this task. ` +
        'Change files only inside it. Do not switch branches, merge, rebase onto other branches ' +
        'or push unless the user asks.'
      : `Your working folder is ${cwd}, the project's main working copy.`,
    context.length
      ? `Project context, read it when it matters for the task: ${context.join('; ')}. ` +
        'Do not edit files in .skaro/: Skaro owns them.'
      : 'Do not edit files in .skaro/: Skaro owns them.',
    `## Task ${task.id}: ${task.title}\n\n${task.body.trim()}`,
    deps.length ? `## Finished tasks this one depends on\n\n${deps.join('\n')}` : '',
    artifacts.config.agentInstructions?.trim()
      ? `## Project instructions\n\n${artifacts.config.agentInstructions.trim()}`
      : '',
    '## Working with Skaro\n\n' +
      [
        '- The user talks to you in the task chat. When the work is done, summarize what you did.',
        '- Commit your work to the task branch with clear messages when a piece is done.',
        '- When the user asks to merge the task, call the merge_task tool of the skaro MCP ' +
          'server with a short summary. Skaro shows the user a confirmation card and merges ' +
          'after the user confirms; never merge into the base branch yourself.',
        `- Write to the user in ${language}: replies, questions, plans and command descriptions.`,
      ].join('\n'),
  ];
  return parts.filter(Boolean).join('\n\n');
}
