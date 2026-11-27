import type { Milestone, ProjectArtifacts, Task } from '@skaro/core';
import { join } from 'node:path';
import { taskSections } from './task-body';
import { agentInteractionInstructions } from './agent-interaction-instructions';
import { taskEnvironmentInstructions } from './task-environment-instructions';
import { LANGUAGES, terms, instructionsOf } from './prompt-context';

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
          'to perform routine environment preparation. Ask concrete missing decisions through Skaro ask_owner, ' +
          'continue independent steps, then perform the selected action. For an evidenced external incident or an explicit ' +
          'owner pause/read-only limitation, call report_task_blocker with requires_owner_permission=false. ' +
          'A rule requiring separate consent is a pending permission request, not an owner pause. ' +
          'Never use a blocker for missing consent or unfinished routine work.',
        '- Follow project verification rules and check only the applicable outcomes. Documentation and small ' +
          'changes do not imply a build when project rules exempt them. Verification notes are suggested methods; ' +
          'use equivalent authorized evidence when it proves the same outcome. In submit_result include named executable checks ' +
          'you actually ran, so Skaro can repeat them when integrating accepted results. Use real project ' +
          'services; do not add mock services or tests for unrelated behavior. If Skaro reports pending ' +
          'integration, end the turn and leave the accepted checkout untouched: it continues automatically.',
        '- Record skipped, unavailable or failed verification methods in verification_observations. For a required ' +
          'outcome that cannot be verified, submit the completed work and evidence with met=false and status=unavailable before resolving the prerequisite. ' +
          'If the criterion itself is wrong, propose a specific owner-reviewed correction without marking it met.',
        '- If submit_result has an uncertain outcome, call reconcile_task_submission with its original ' +
          'operation_id. It inspects saved evidence without resubmitting. Checked criteria alone do not ' +
          'prove acceptance. After reconciliation inspect current task state before a fresh submission; ' +
          'never repeat an unknown effect.',
        '- Use the task-local Playwright MCP for changed UI or directly affected browser behavior when applicable. ' +
          'When the change does not affect browser behavior, do not start a browser or report its absence as a blocker.',
        '- If required verification needs an API key, password or other credential from the owner, ' +
          'first check whether the approved requirement really needs the live provider and whether equivalent ' +
          'authorized evidence exists. For an indispensable credential, call request_secret with the protected fields as soon as the input is ' +
          'needed. Do not ask for a secret in ordinary chat, claim a field was shown without a ' +
          'successful call, submit an incomplete result, or report missing owner credentials as ' +
          'an external blocker before offering the protected input. After request_secret succeeds, ' +
          'continue steps independent of the credential. The protected answer will reach this task. If a real project settings form is ' +
          'the required destination, identify its actual URL and use the provided credential there.',
        '- Keep the user informed while you work: before each step write one short sentence ' +
          'about what you are doing now. Work in small steps; do not think the whole task ' +
          'through in one long silent pass.',
        (branch
          ? '- Commit completed pieces to the registered task branch. '
          : '- Work in the current checkout. Do not create or switch branches in this shared copy. If a PR is required, use the managed task checkout before starting implementation. ') +
          'Commit messages follow ' +
          "the repository's commit convention: look at git log, a commitlint config or " +
          'CONTRIBUTING. If the repository has none, use Conventional Commits in English ' +
          '(feat: вЂ¦, fix: вЂ¦, docs: вЂ¦). The project instructions below may say otherwise.',
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
        '- If verification requires a GitHub workflow published before final acceptance, retain the open criteria. For an explicitly approved PR call merge_task with partial=true and publication={pullRequest,head,workflow}, follow its scoped command and verify the returned publication. If blocked on this prerequisite use external code github_workflow_publication_missing. Publication itself does not authorize executing the workflow.',
        '- When the user asks to merge, call merge_task. Skaro merges the accepted results and ' +
          'updates task statuses. Each task is merged independently after its own accepted result; ' +
          'do not wait for every task of its milestone. There is no separate milestone agent or chat. Never merge into ' +
          'the base branch yourself. Report review as awaiting merge, and done only after confirmed publication.',
        '- Unrelated uncommitted work in the main copy is not a reason to stop publication of your ' +
          'verified result. Use Skaro merge and immutable candidate/release operations with exact inputs; ' +
          'preserve unrelated files and staging. If paths overlap, use the existing local-change resolver. ' +
          "Do not require a globally clean main copy, stash, commit or remove another task's work.",
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
