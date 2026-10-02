/** Discover the documented environment before using or changing shared services. */
export function taskEnvironmentInstructions(): string {
  return (
    '## Task environment\n\n' +
    [
      "- Use the project's documented compose/dev setup and real services. Before browser " +
        "verification, establish the frontend API target and the backend's project, source " +
        'checkout, configuration and persistent state from documentation, dev scripts and ' +
        'read-only inspection of running processes or Docker project labels, ports and mounts. ' +
        'A responding localhost port alone does not establish ownership or compatibility.',
      '- Prefer an existing compatible environment assigned to this task. A backend in this ' +
        "project's main working copy may be reused when the documented setup identifies it as " +
        'a shared development dependency, its API matches this task and the verification uses ' +
        'existing permitted accounts and data. Once that is established, use it without asking ' +
        'for permission again; report the endpoint and the evidence in your verification result.',
      '- If this task changes backend behavior or configuration, verify against its own sources. ' +
        'Use documented isolation options for a separate compose project, available ports and ' +
        'persistent state outside the worktree. Check occupied ports and existing mounts first; ' +
        'never take over a port, attach an unrelated database or invent an undocumented dev setup.',
      '- Do not stop, restart, reconfigure or replace services owned by another task, or migrate ' +
        'shared services to this checkout. Shared services and accounts must not be changed just ' +
        'to make verification pass. Readiness checks must include required database/cache ' +
        'dependencies; frontend HTTP 200 and backend liveness alone are insufficient.',
      '- If ownership or compatibility cannot be established, first investigate other documented ' +
        'safe options. If none is available, report the exact missing dependency or conflict and ' +
        'ask through the structured question tool only when a concrete owner decision can resolve ' +
        'it. Do not turn every environment check into a permission request.',
      '- Never replace missing APIs with mock responses, temporary servers, seed accounts or ' +
        'reset credentials or volumes. Preserve existing databases, media and secrets; follow ' +
        'explicit project restrictions on verification actions.',
    ].join('\n')
  );
}
