import type { Milestone, ProjectArtifacts, Task } from '@skaro/core';
import { join } from 'node:path';
import { taskSections } from './task-body';
import { agentInteractionInstructions } from './agent-interaction-instructions';
import { taskEnvironmentInstructions } from './task-environment-instructions';
import { LANGUAGES, terms, instructionsOf } from './prompt-context';
import { C4_INSTRUCTIONS } from './c4-instructions';

export function taskInstructions(options: {
  task: Task;
  artifacts: ProjectArtifacts;
  /** The project's main working copy: .skaro/ lives there, not in the task worktree. */
  root: string;
  cwd: string;
  branch?: string;
  /** The milestone whose branch and checkout the task shares with its other tasks. */
  stage?: Pick<Milestone, 'id' | 'title'>;
  locale: string;
  /** The project describes a task environment and Skaro runs it (task-environments.md). */
  managedEnvironment?: boolean;
}): string {
  const { task, artifacts, root, cwd, branch, stage } = options;
  const language = LANGUAGES[options.locale] ?? 'English';
  const skaro = join(root, '.skaro');
  const context = [
    artifacts.brief && `${join(skaro, 'brief.md')} (what the project is)`,
    artifacts.architecture &&
      `${join(skaro, 'architecture.md')} (architecture, rules and constraints)`,
    artifacts.adrs.length && `${join(skaro, 'adr')} (architecture decisions)`,
  ].filter(Boolean);
  const spec = task.spec ? artifacts.specs.find((s) => s.id === task.spec) : undefined;
  if (spec) {
    context.push(
      `${join(root, spec.path)} (SPEC-${spec.id} "${spec.title}", the specification this task ` +
        'implements; its requirements R-n are what the function must do)',
    );
  }
  const criteria = taskSections(task.body).criteria.map((c, i) => `${i + 1}. ${c.text}`);
  const deps = task.dependsOn
    .map((id) => artifacts.tasks.find((t) => t.id === id))
    .filter((t): t is Task => t !== undefined)
    .map((t) => {
      const summary = taskSections(t.body).summary;
      return `- ${t.id} ${t.title}${summary ? `: ${summary.replace(/\s+/g, ' ')}` : ''}`;
    });

  const parts = [
    C4_INSTRUCTIONS,
    `You are working on task ${task.id} "${task.title}" in a project managed by Skaro.`,
    task.status === 'done'
      ? 'The task is done and merged into the base branch. The user may ask follow-up ' +
        'questions about it. Change files only if the user asks, and tell them the changes are ' +
        'in the main working copy and are not committed by Skaro.'
      : '',
    branch && stage
      ? `Your working folder ${cwd} is a git worktree on branch ${branch}, shared by the tasks ` +
        `of milestone ${stage.id} "${stage.title}". They run one after another: the work of the ` +
        'earlier ones is already committed there and only your task works in it now. The ' +
        'environment (services and data) belongs to the milestone in the same way. Change files ' +
        'only inside the folder. Do not switch branches, merge, rebase onto other branches or ' +
        'push unless the user asks.'
      : branch
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
    task.milestone
      ? `## Milestone context\n\n${artifacts.milestones.find((item) => item.id === task.milestone)?.body ?? ''}\n\nCover the milestone requirements relevant to this task in its acceptance; no separate milestone agent will run.`
      : '',
    deps.length ? `## Finished tasks this one depends on\n\n${deps.join('\n')}` : '',
    instructionsOf(artifacts),
    '## Working with Skaro\n\n' +
      [
        '- The user talks to you in the task chat.',
        '- Starting a task authorizes its implementation, affected verification and submission. ' +
          'A model final answer is not task completion: Skaro continues unfinished execution automatically. ' +
          'Do not end a turn merely to request continue, repeat established decisions or ask the owner ' +
          'to perform routine environment preparation. Ask concrete missing decisions through the blocking ' +
          'question tool, then perform the selected action. For an evidenced external blocker or an explicit ' +
          'owner pause/read-only limitation, call report_task_blocker. Never use it for unfinished routine work.',
        '- Include verification in submit_result: named executable build and affected behavior checks ' +
          'you actually ran, so Skaro can repeat them when integrating accepted results. Use real project ' +
          'services; do not add mock services or tests for unrelated behavior. If Skaro reports pending ' +
          'integration, end the turn and leave the accepted checkout untouched: it continues automatically.',
        '- Skaro supplies a task-local Playwright MCP server. Use its browser tools for UI ' +
          'verification; a Codex desktop browser or personal Chrome connection is not required. ' +
          'The browser uses an isolated profile. If Chrome is missing, report the blocker.',
        '- Keep the user informed while you work: before each step write one short sentence ' +
          'about what you are doing now. Work in small steps; do not think the whole task ' +
          'through in one long silent pass.',
        '- Commit your work to the task branch when a piece is done. ' +
          'Commit messages follow ' +
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
              '- Report acceptance as verified only when submit_result reports every criterion met. ' +
                'Say the task is done only when Skaro confirms its done status or publication. ' +
                'Otherwise tell the user which criteria remain open or that the accepted result awaits merge.',
            ]
          : [
              '- When the work is done, call submit_result with criteria: [], a summary and a commit message.',
            ]),
        '- When the user asks to merge, call merge_task. Skaro merges the accepted results and ' +
          'updates task statuses. Each task is merged independently after its own accepted result; ' +
          'do not wait for every task of its milestone. There is no separate milestone agent or chat. Never merge into ' +
          'the base branch yourself. Report review as awaiting merge, and done only after confirmed publication.',
        '- After submit_result, automatic mode merges this accepted task; manual mode shows a confirmation card in a real task chat. ' +
          'If Skaro reports that publication succeeded, ' +
          'do not call merge_task again to confirm it.',
        '- If you start or repair GitHub CI or release workflows, register the real run ID with ci_run. ' +
          'Task completion and release delivery are separate: report each from its verified state.',
        `- Write to the user in ${language}: replies, questions, plans and command descriptions.`,
        ...terms(options.locale),
      ].join('\n'),
    agentInteractionInstructions(),
    taskEnvironmentInstructions(
      !branch ? 'in-place' : options.managedEnvironment ? 'managed' : 'own',
    ),
  ];
  return parts.filter(Boolean).join('\n\n');
}
