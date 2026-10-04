// Instructions for the acceptance of a stage: every task of the milestone is finished and
// committed in its branch; the agent checks the milestone's readiness criterion on the whole.

import type { Milestone, ProjectArtifacts } from '@skaro/core';
import { join } from 'node:path';
import { agentInteractionInstructions } from './agent-interaction-instructions';
import { instructionsOf, LANGUAGES, terms } from './prompt';
import { taskSections } from './task-body';
import { taskEnvironmentInstructions } from './task-environment-instructions';
import { stageTasks } from './task-stage';
import { readinessAsList } from './task-subject';

export function acceptanceInstructions(options: {
  stage: Milestone;
  artifacts: ProjectArtifacts;
  /** The project's main working copy: .skaro/ lives there, not in the checkout of the stage. */
  root: string;
  cwd: string;
  branch: string;
  locale: string;
  managedEnvironment?: boolean;
}): string {
  const { stage, artifacts, root, cwd, branch } = options;
  const language = LANGUAGES[options.locale] ?? 'English';
  const skaro = join(root, '.skaro');
  const body = readinessAsList(stage.body);
  const criteria = taskSections(body).criteria.map((c, i) => `${i + 1}. ${c.text}`);
  const tasks = stageTasks(stage, artifacts).map((t) => {
    const summary = taskSections(t.body).summary;
    return `- ${t.id} ${t.title}${summary ? `: ${summary.replace(/\s+/g, ' ')}` : ''}`;
  });
  const specs = [...new Set(stageTasks(stage, artifacts).flatMap((t) => (t.spec ? [t.spec] : [])))]
    .map((id) => artifacts.specs.find((s) => s.id === id))
    .flatMap((s) => (s ? [`${join(root, s.path)} (SPEC-${s.id} "${s.title}")`] : []));
  const context = [
    artifacts.brief && `${join(skaro, 'brief.md')} (what the project is)`,
    artifacts.architecture &&
      `${join(skaro, 'architecture.md')} (architecture, rules and constraints)`,
    artifacts.adrs.length && `${join(skaro, 'adr')} (architecture decisions)`,
    ...specs,
  ].filter(Boolean);

  const parts = [
    `You run the acceptance of milestone ${stage.id} "${stage.title}" in a project managed by ` +
      'Skaro. Every task of the milestone is finished; the tasks ran one after another and each ' +
      'left one commit in the branch of the milestone.',
    `Your working folder ${cwd} is a git worktree on branch ${branch}, the branch of the ` +
      'milestone. Change files only inside it. Do not switch branches, merge, rebase onto other ' +
      'branches or push unless the user asks.',
    (context.length
      ? 'Project context, read it when it matters (these files are in the main project folder, ' +
        `not in your working folder): ${context.join('; ')}. The get_project_context tool of ` +
        'the skaro MCP server returns the same. '
      : '') + 'Do not edit files in .skaro/: Skaro owns them.',
    `## Milestone ${stage.id}: ${stage.title}\n\n${body.trim()}`,
    criteria.length
      ? `## Readiness criteria, numbered for submit_result\n\n${criteria.join('\n')}`
      : '',
    tasks.length ? `## Tasks of the milestone\n\n${tasks.join('\n')}` : '',
    instructionsOf(artifacts),
    '## Working with Skaro\n\n' +
      [
        '- The user talks to you in the chat of the milestone.',
        '- The tasks checked their own acceptance criteria. Your job is what none of them could ' +
          'check: that the milestone works as a whole. Verify every readiness criterion end to ' +
          'end on this branch: run the code and the tests, and go through the user scenarios.',
        '- Skaro supplies a Playwright MCP server with an isolated browser profile. Use its ' +
          'browser tools for UI verification. If Chrome is missing, report the blocker.',
        '- Keep the user informed while you work: before each step write one short sentence ' +
          'about what you are doing now.',
        '- When a criterion fails because of a defect you can fix, fix it and commit the fix to ' +
          "the branch, in the repository's commit convention (git log, a commitlint config or " +
          'CONTRIBUTING; Conventional Commits in English if there is none). Then verify again.',
        '- When a criterion cannot be met without a decision of the user, ask through the ' +
          'structured question tool and offer the real options: to retry later, to make a new ' +
          'task of the milestone for the missing work, or to accept the criterion as it is.',
        ...(criteria.length
          ? [
              '- Call the submit_result tool of the skaro MCP server with a verdict and evidence ' +
                'for each readiness criterion, and a commit message for the fixes you made. ' +
                'Skaro ticks the criteria in the milestone from it. A criterion you did not ' +
                'verify is not met.',
              '- When every criterion is ticked Skaro shows the user a card to merge the ' +
                'milestone, or merges it at once in automatic mode. Never merge into the base ' +
                'branch yourself and do not call merge_task.',
            ]
          : []),
        `- Write to the user in ${language}: replies, questions, plans and command descriptions.`,
        ...terms(options.locale),
      ].join('\n'),
    agentInteractionInstructions(),
    taskEnvironmentInstructions(options.managedEnvironment ? 'managed' : 'own'),
  ];
  return parts.filter(Boolean).join('\n\n');
}
