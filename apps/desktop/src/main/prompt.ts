// Instructions for the agent of a task (architecture.md 7, step 3): project rules, where the
// project context is, the task itself, summaries of finished dependencies, Skaro's workflow.

import type { ProjectArtifacts, Task } from '@skaro/core';
import { join } from 'node:path';
import { taskSections } from './task-body';

const LANGUAGES: Record<string, string> = { ru: 'Russian', en: 'English' };

/** The user's instructions: app-wide ("Настройки") first, then the project's own. */
function instructionsOf(artifacts: ProjectArtifacts): string {
  const all = [artifacts.config.globalInstructions, artifacts.config.agentInstructions]
    .map((text) => text?.trim())
    .filter(Boolean);
  return all.length ? `## Project instructions\n\n${all.join('\n\n')}` : '';
}

/**
 * Instructions for a project chat (architecture.md 9, agent-output.md 5.4): talk the project
 * through, read code only, turn the result into artifacts through Skaro's tools.
 */
export function chatInstructions(options: {
  projectName: string;
  root: string;
  artifacts: ProjectArtifacts;
  locale: string;
}): string {
  const { artifacts } = options;
  const language = LANGUAGES[options.locale] ?? 'English';
  const has = [
    artifacts.brief && 'a brief',
    artifacts.architecture && 'an architecture',
    artifacts.adrs.length && `${artifacts.adrs.length} ADRs`,
    artifacts.milestones.length && `${artifacts.milestones.length} milestones`,
    artifacts.tasks.length && `${artifacts.tasks.length} tasks`,
  ].filter(Boolean);
  const parts = [
    `You are the project agent of "${options.projectName}" in Skaro, talking with the user in a ` +
      'project chat. Skaro keeps the project context in .skaro/: the brief, the architecture ' +
      '(with a "Rules and constraints" section coding agents must follow), ADRs, milestones and ' +
      'tasks. Coding agents implement the tasks later, each in its own branch.',
    `The project folder is ${options.root}. ` +
      (has.length ? `The project has ${has.join(', ')}.` : 'The project has no artifacts yet.'),
    '## Your job\n\n' +
      [
        '- Discuss what to build with the user, ask questions when something is unclear.',
        '- Turn what you agree on into artifacts with the tools of the skaro MCP server: ' +
          'get_project_context, write_doc (brief.md, architecture.md, docs/<name>.md), ' +
          'propose_adr, propose_milestones, propose_tasks, update_task.',
        '- Read get_project_context before writing documents or proposing milestones and tasks.',
        '- For an existing codebase, study the code before writing the brief and the architecture.',
        '- Tasks must be small enough for one agent run, with 2–6 checkable acceptance criteria ' +
          'and explicit dependencies. Group them into milestones.',
      ].join('\n'),
    '## Rules\n\n' +
      [
        '- This chat is read-only: read code to understand the project, never change files and ' +
          'never run commands that change anything.',
        '- Do not edit files in .skaro/ directly: only Skaro writes there, through the tools.',
        '- Proposals appear to the user as cards and the tools return at once. Do not wait for ' +
          'decisions and do not ask the user to confirm in text what the card already asks.',
        "- The user's decisions on cards arrive at the start of their next message inside " +
          '<skaro-note>…</skaro-note>. Take them into account; do not quote the note back.',
        `- Write to the user, the documents and the task texts in ${language}.`,
      ].join('\n'),
    instructionsOf(artifacts),
  ];
  return parts.filter(Boolean).join('\n\n');
}

export function taskInstructions(options: {
  task: Task;
  artifacts: ProjectArtifacts;
  /** The project's main working copy: .skaro/ lives there, not in the task worktree. */
  root: string;
  cwd: string;
  branch?: string;
  locale: string;
}): string {
  const { task, artifacts, root, cwd, branch } = options;
  const language = LANGUAGES[options.locale] ?? 'English';
  const skaro = join(root, '.skaro');
  const context = [
    artifacts.brief && `${join(skaro, 'brief.md')} (what the project is)`,
    artifacts.architecture &&
      `${join(skaro, 'architecture.md')} (architecture, rules and constraints)`,
    artifacts.adrs.length && `${join(skaro, 'adr')} (architecture decisions)`,
  ].filter(Boolean);
  const criteria = taskSections(task.body).criteria.map((c, i) => `${i + 1}. ${c.text}`);
  const deps = task.dependsOn
    .map((id) => artifacts.tasks.find((t) => t.id === id))
    .filter((t): t is Task => t !== undefined)
    .map((t) => {
      const summary = taskSections(t.body).summary;
      return `- ${t.id} ${t.title}${summary ? `: ${summary.replace(/\s+/g, ' ')}` : ''}`;
    });

  const parts = [
    `You are working on task ${task.id} "${task.title}" in a project managed by Skaro.`,
    task.status === 'done'
      ? 'The task is done and merged into the base branch. The user may ask follow-up ' +
        'questions about it. Change files only if the user asks, and tell them the changes are ' +
        'in the main working copy and are not committed by Skaro.'
      : '',
    branch
      ? `Your working folder ${cwd} is a git worktree on branch ${branch}, made for this task. ` +
        'Change files only inside it. Do not switch branches, merge, rebase onto other branches ' +
        'or push unless the user asks.'
      : `Your working folder is ${cwd}, the project's main working copy.`,
    (context.length
      ? 'Project context, read it when it matters for the task (these files are in the main ' +
        `project folder, not in your working folder): ${context.join('; ')}. The ` +
        'get_project_context tool of the skaro MCP server returns the same. '
      : '') + 'Do not edit files in .skaro/: Skaro owns them.',
    `## Task ${task.id}: ${task.title}\n\n${task.body.trim()}`,
    criteria.length
      ? `## Acceptance criteria, numbered for submit_result\n\n${criteria.join('\n')}`
      : '',
    deps.length ? `## Finished tasks this one depends on\n\n${deps.join('\n')}` : '',
    instructionsOf(artifacts),
    '## Working with Skaro\n\n' +
      [
        '- The user talks to you in the task chat.',
        '- Commit your work to the task branch when a piece is done. Commit messages follow ' +
          "the repository's commit convention: look at git log, a commitlint config or " +
          'CONTRIBUTING. If the repository has none, use Conventional Commits in English ' +
          '(feat: …, fix: …, docs: …). The project instructions below may say otherwise.',
        ...(criteria.length
          ? [
              '- Before you say the task is done, verify every acceptance criterion yourself ' +
                '(run the code, the tests, measure) and call the submit_result tool of the skaro ' +
                'MCP server with a verdict and evidence for each one, and a commit message for ' +
                'the merge in the same convention. Skaro ticks the criteria in the task from it. ' +
                'A criterion you did not verify is not met.',
              '- Call submit_result every time the user asks to check the criteria or to submit ' +
                'the result, even if nothing changed since the last call.',
              '- Say the task is done only when submit_result reports every criterion met. ' +
                'Otherwise tell the user plainly which criteria are not met and why.',
            ]
          : ['- When the work is done, summarize what you did.']),
        '- When the user asks to merge the task, call the merge_task tool of the skaro MCP ' +
          'server with a short summary. Skaro shows the user a confirmation card and merges ' +
          'after the user confirms; never merge into the base branch yourself. Skaro does not ' +
          'merge while acceptance criteria are not ticked.',
        `- Write to the user in ${language}: replies, questions, plans and command descriptions.`,
      ].join('\n'),
  ];
  return parts.filter(Boolean).join('\n\n');
}
