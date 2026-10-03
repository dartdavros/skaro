const MANAGED =
  "- Skaro runs this task's environment: the project's services on your sources, with a " +
  'disposable copy of the data of the main environment. Call the start_environment tool of the ' +
  'skaro MCP server when you need running services (browser verification, integration checks, ' +
  'service logs); it returns the addresses once the services are ready. The first call builds ' +
  'images and copies data and may take several minutes.\n' +
  '- Do not start, recreate or re-point services yourself: no `docker compose up`, `docker run`, ' +
  'other project names, ports, data folders or override files. Skaro gives the environment its ' +
  'name, ports and data; your shell already has them (COMPOSE_PROJECT_NAME and the port ' +
  'variables), so `docker compose ps`, `logs` and `exec` address it.\n' +
  '- The environment holds nothing unique. Skaro stops it while the task is idle and removes it ' +
  'when the task is merged, so call start_environment again whenever you need the services, ' +
  'and never keep there anything that must survive the task.';

const UNMANAGED =
  "- Use the project's documented compose/dev setup and real services. Your shell has " +
  "COMPOSE_PROJECT_NAME set to this task's own project name: keep it, so that everything you " +
  'start belongs to this task. Take free ports and keep persistent state outside the ' +
  'worktree; never take over a port or attach a database of another task or of the main ' +
  'working copy.\n' +
  '- Skaro stops the containers of an idle task when more tasks run than the limit allows, and ' +
  'removes them when the task is merged. Start them again with the same commands when you need ' +
  'them, and never keep there anything that must survive the task.';

const IN_PLACE =
  "- You work in the project's main working copy: use its documented compose/dev setup and " +
  'real services as they are. Check occupied ports and existing mounts before you start ' +
  'anything; never invent an undocumented dev setup.';

/** Skaro runs the environment, the task brings up its own, or the task works in the main copy. */
export type TaskEnvironmentKind = 'managed' | 'own' | 'in-place';

/** How a task gets running services, and what stays forbidden while it verifies its work. */
export function taskEnvironmentInstructions(kind: TaskEnvironmentKind): string {
  return (
    '## Task environment\n\n' +
    [
      kind === 'managed' ? MANAGED : kind === 'own' ? UNMANAGED : IN_PLACE,
      '- Before browser verification make sure the frontend talks to the backend of this ' +
        "task's environment and that readiness includes the database and cache. A responding " +
        'localhost port, frontend HTTP 200 or backend liveness alone prove nothing.',
      '- Do not stop, restart, reconfigure or replace services of another task or of the main ' +
        'working copy, and do not change shared services or accounts to make verification pass.',
      '- If the environment cannot be started or is not ready, report the exact failure as a ' +
        'blocker; ask through the structured question tool only when a concrete owner decision ' +
        'can resolve it. Do not turn every environment check into a permission request.',
      '- Never replace missing APIs with mock responses, temporary servers, seed accounts or ' +
        'reset credentials or volumes. Follow explicit project restrictions on verification ' +
        'actions.',
    ].join('\n')
  );
}
