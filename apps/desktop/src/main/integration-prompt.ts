import type { ProjectArtifacts } from '@skaro/core';
import type { IntegrationOperation } from './integration-model';
import { agentInteractionInstructions } from './agent-interaction-instructions';
import { localResolutionInstructions } from './integration-local-changes';

export function integrationInstructions(
  op: IntegrationOperation,
  root: string,
  artifacts: ProjectArtifacts,
): string {
  return [
    `You are resolving Skaro integration ${op.id} for task ${op.taskId}.`,
    `Work only in ${op.worktree}. Project documentation is in ${root}/.skaro/. Read AGENTS.md and applicable architecture/specifications.`,
    `The base is ${op.baseHead}. Immutable accepted inputs: ${JSON.stringify(op.results)}`,
    'Requirements of incoming and affected base tasks: ' +
      JSON.stringify(
        artifacts.tasks
          .filter((task) =>
            [...op.results, ...(op.baseResults ?? [])].some((result) => result.taskId === task.id),
          )
          .map((task) => ({
            id: task.id,
            title: task.title,
            path: task.path,
            spec: task.spec,
            body: task.body,
          })),
      ),
    `Accepted base behaviors overlapping these inputs: ${JSON.stringify(op.baseResults ?? [])}. ` +
      'Cover their requirements and regression checks too. Legacy results may lack executable checks; ' +
      'derive those checks from the real project tests and acceptance evidence.',
    'Preserve the requirements and behavior of all input tasks and the base. Inspect Git base/ours/theirs ' +
      'and related code. Resolve the actual conflicts and necessary compatibility changes; never select ' +
      'one side wholesale or remove behavior to make the merge pass. Do not implement the pending task yet.',
    `Conflict paths: ${JSON.stringify(op.conflicts)}.`,
    ...localResolutionInstructions(op),
    `Last recorded failure: ${op.error ?? 'none'}. Retained check evidence: ${JSON.stringify(op.checkRuns ?? [])}.`,
    'Stage your resolution. Skaro owns commit, merge continuation and publication: do not commit, rebase, ' +
      'reset, switch branches, merge other inputs, push, edit .skaro or change the accepted source worktrees.',
    'Call verify_integration with a structured list of real build and affected behavior checks covering ' +
      'both sides. Skaro executes them on this exact candidate. If it returns another conflict or a ' +
      'failed check, fix it here and call again. A final text answer cannot accept the integration. ' +
      'Ending the turn without a verified candidate stops the integration until the owner replies: ' +
      'do it only for a real blocker and state that blocker exactly.',
    'Skaro closes this session when the turn ends and stops every command it left running in the ' +
      'background. Wait for a long command inside the turn; never end the turn to wait for it.',
    'Checks default to cmd.exe on Windows and the system shell elsewhere. For PowerShell scripts, ' +
      'set shell: "powershell"; submitting a saved command with a shell corrects that check. To ' +
      'repair a saved check, keep its name and coverage and set replaces to the exact previous run ' +
      'string. Adding another command alone does not remove the old one. ' +
      'Replacements and additional checks persist for retries; the accepted input records stay immutable.',
    `Mandatory project checks: ${JSON.stringify(artifacts.config.checks)}.`,
    'Use start_environment/configure_environment to run the real project services on this candidate. ' +
      'Skaro gives this integration its own compose name, ports and data. Never start substitute services, ' +
      'mock APIs or overwrite another environment. Never start services yourself when managed by Skaro.',
    'Skaro publishes only allocated host ports. Test/admin services used through compose exec need no ' +
      'host port. If documented external access is needed, add port variable names with ports and ' +
      'expected_ports through configure_environment; Skaro allocates them. Perform this routine ' +
      'configuration yourself; do not ask the owner to choose ports or edit settings.',
    'Explain what you are resolving and checking in the task language. Technical integration work is ' +
      'authorized by the task; the owner does not need to edit files or retry the operation manually.',
    artifacts.config.globalInstructions ?? '',
    artifacts.config.agentInstructions ?? '',
    agentInteractionInstructions(),
  ].join('\n\n');
}
