const MANAGED =
  "- Skaro runs this task's environment: the project's services on your sources, with a " +
  'disposable copy of the data of the main environment. Call the start_environment tool of the ' +
  'skaro MCP server when you need running services (browser verification, integration checks, ' +
  'service logs); it returns the addresses once the services are ready. The first call builds ' +
  'images and copies data and may take several minutes.\n' +
  '- After changing sources, dependencies, service configuration or migrations, call ' +
  'start_environment again before claiming verification. The project launch command must ' +
  "build/restart the required services and run its documented migrations. Verify this task's " +
  'current code; another task finishing does not update your checkout.\n' +
  '- If a documented service required by the task is missing from the launch command, use ' +
  'configure_environment with no arguments to read it, then pass start and expected_start to ' +
  'save the corrected command for this environment. Call start_environment afterwards and ' +
  'verify the required service with compose ps/exec before running its tests. Carry out this ' +
  'routine setup yourself through Skaro; do not ask the owner to edit settings by hand. ' +
  'Preserve existing services, name, ports, data and readiness. Explicit owner restrictions ' +
  'still apply; an owner decision is authorization to perform the agreed action, not evidence ' +
  'that the owner has already performed it. Do not wait for them to do your configuration work.\n' +
  '- If first-time copying requires stopped source services, inspect the project clone script ' +
  'and existing Docker labels, read configure_environment, then declare source {project, services} ' +
  'with expected_source (the current value or null). start_environment starts only these existing ' +
  'main-checkout containers and waits for health before copying. This is routine preparation: ' +
  'do not ask the owner to start the source database or choose between waiting and unverified code. ' +
  'Never create, reset, seed or reconfigure the source, its accounts, volumes or mounts.\n' +
  '- Skaro admits every Compose port before starting services. Services without allocated host ' +
  'ports, including test/admin backends, stay accessible inside the Compose network and through ' +
  '`docker compose exec`; they need no host port for tests. If the authorized task needs documented ' +
  'host access, read configure_environment and add the documented port variable names with ports ' +
  'and expected_ports. Skaro chooses free numbers. This routine tool configuration requires no ' +
  'owner decision. Do not add inline port overrides, choose port numbers or ask the owner to do it.\n' +
  '- Do not start, recreate or re-point services yourself: no `docker compose up`, `docker run`, ' +
  'other project names, ports, data folders or override files. Skaro gives the environment its ' +
  'name, ports and data; your shell already has them (COMPOSE_PROJECT_NAME and the port ' +
  'variables), so `docker compose ps`, `logs` and `exec` address it. Skaro can replace a port ' +
  'occupied after stopping the environment; use the current addresses returned by start_environment ' +
  'for browser/HTTP checks. The service-owned Compose files keep ps/logs/exec on the current bindings.\n' +
  "- Skaro retains this task's data through review and fixes. A user opening an environment " +
  'link in this feed owns a review slot until Finish review; your next turn waits for it. ' +
  'Skaro stops unused services and removes the environment ' +
  'when the task is merged, so call start_environment again whenever you need the services, ' +
  'and never keep there anything that must survive the task.';

const UNMANAGED =
  "- Use the project's documented compose/dev setup and real services. Your shell has " +
  "COMPOSE_PROJECT_NAME set to this task's own project name: keep it, so that everything you " +
  'start belongs to this task. Take free ports and keep persistent state outside the ' +
  'worktree; never take over a port or attach a database of another task or of the main ' +
  'working copy.\n' +
  '- Skaro stops the containers of an idle task when its agent turn ends, and ' +
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
        'working copy. The only source-start path is Skaro starting declared existing main-checkout ' +
        'containers for data copying; do not change shared services or accounts to make verification pass.',
      '- If the environment cannot be started or is not ready, report the exact failure as a ' +
        'blocker; ask through the structured question tool only when a concrete owner decision ' +
        'can resolve it. Do not turn every environment check into a permission request.',
      '- Never replace missing APIs with mock responses, temporary servers, seed accounts or ' +
        'reset credentials or volumes. Follow explicit project restrictions on verification ' +
        'actions.',
    ].join('\n')
  );
}
