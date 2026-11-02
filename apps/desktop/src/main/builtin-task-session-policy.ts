import { isDeepStrictEqual } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import type { BuiltinSessionStart, SessionOptions, SkaroScope } from '@skaro/timeline';

/** A prepared host may narrow task access, but cannot substitute its scope or task instructions. */
export function requireBuiltinTaskSessionPolicy(
  expected: {
    scope: SkaroScope;
    sessionId: string;
    journalPath: string;
    artifactDir: string;
    options: Pick<
      SessionOptions,
      | 'cwd'
      | 'readDirs'
      | 'readOnly'
      | 'permissionMode'
      | 'planFirst'
      | 'instructions'
      | 'model'
      | 'effort'
    >;
  },
  config: BuiltinSessionStart,
) {
  const { scope, options } = expected;
  if (
    scope.kind !== 'task' ||
    !scope.taskId ||
    !scope.runId ||
    Object.keys(scope).some((name) => !['kind', 'projectId', 'taskId', 'runId'].includes(name))
  )
    throw new Error('Builtin startup requires a task/run scope');
  if (
    config.sessionId !== expected.sessionId ||
    !isAbsolute(config.journalPath) ||
    resolve(config.journalPath) !== resolve(expected.journalPath) ||
    config.permissionMode !== options.permissionMode ||
    !config.tools ||
    !isAbsolute(config.tools.cwd) ||
    !isAbsolute(config.tools.artifactDir) ||
    resolve(config.tools.cwd) !== resolve(options.cwd) ||
    resolve(config.tools.artifactDir) !== resolve(expected.artifactDir) ||
    ((options.planFirst || options.readOnly) && !config.tools.readOnly) ||
    config.tools.readDirs.some(
      (path) =>
        !isAbsolute(path) ||
        !(options.readDirs ?? []).some((allowed) => resolve(allowed) === resolve(path)),
    ) ||
    !config.model?.input ||
    !isDeepStrictEqual(config.model.scope, scope) ||
    (config.tools.verificationScope && !isDeepStrictEqual(config.tools.verificationScope, scope)) ||
    (config.extensionsScope && !isDeepStrictEqual(config.extensionsScope, scope))
  )
    throw new Error('Prepared builtin host differs from the current task session');
  if (
    !options.instructions ||
    !config.context?.pins.some(
      (pin) =>
        pin.kind === 'constraint' && pin.origin === 'host' && pin.text === options.instructions,
    )
  )
    throw new Error('Builtin context must retain the exact task and handoff instructions');
  if (
    (options.model && ![config.route.routeId, config.route.modelId].includes(options.model)) ||
    (options.effort &&
      config.route.parameters[
        ['openai', 'deepseek'].includes(config.route.connector) ? 'reasoning_effort' : 'effort'
      ] !== options.effort)
  )
    throw new Error('Builtin route differs from the selected task model or effort');
}
