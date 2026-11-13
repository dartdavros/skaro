import { docker, ids } from './cli.ts';
import {
  COMPOSE_PROJECT,
  inspectContainers,
  labelsOf,
  type DockerContainer,
} from './containers.ts';
import {
  inspectDockerObject,
  inspectEnvironmentObjects,
  dockerObjectInUse,
  sameDockerObject,
  type DockerObjectIdentity,
} from './objects.ts';

export interface DockerRemovalStep {
  step: string;
  verify: () => Promise<boolean>;
  execute: () => Promise<void>;
}
export type DockerRemovalExecutor = (step: DockerRemovalStep) => Promise<void>;
export interface DockerRemovalAuthorization {
  guard: () => void | Promise<void>;
  /** Durable prior observations, not authority to delete them. */
  observed: DockerObjectIdentity[];
  observe: (objects: DockerObjectIdentity[]) => void;
  retained: (reason: string) => void;
  effect: () => void;
  settled: () => void;
  authorize: (object: DockerObjectIdentity) => void | Promise<void>;
}
const SLOW = { timeoutMs: 120_000 };
async function exists(object: DockerObjectIdentity): Promise<boolean> {
  const args =
    object.kind === 'image'
      ? ['images', '-a', '-q', '--no-trunc']
      : object.kind === 'network'
        ? ['network', 'ls', '-q', '--no-trunc']
        : ['volume', 'ls', '-q'];
  return ids(await docker(args)).includes(object.id);
}

/** Exact object barriers. Compose labels discover candidates, never grant deletion authority. */
export async function removeOwnedEnvironment(
  containers: DockerContainer[],
  projects: string[],
  run?: DockerRemovalExecutor,
  authorization?: DockerRemovalAuthorization,
): Promise<string[]> {
  const execute: DockerRemovalExecutor =
    run ??
    (async (step) => {
      if (await step.verify()) return;
      await step.execute();
      if (!(await step.verify())) throw new Error('Docker removal was not verified');
    });
  const failures: string[] = [];
  const attempt = async (step: DockerRemovalStep) => {
    try {
      await execute(step);
      return true;
    } catch (error) {
      failures.push(`${step.step}: ${String(error)}`);
      return false;
    }
  };
  const observations = new Map<string, DockerObjectIdentity>();
  const observe = async () => {
    for (const object of [
      ...(authorization?.observed ?? []),
      ...(await inspectEnvironmentObjects(projects, containers)),
    ])
      observations.set(`${object.kind}:${object.id}`, object);
    authorization?.observe([...observations.values()]);
  };
  // Preserve unknown anonymous-volume evidence before container removal, including across restarts.
  await observe();
  const owned = new Map(containers.map((c) => [c.Id, labelsOf(c)[COMPOSE_PROJECT]]));
  const remaining = async () => (await inspectContainers()).filter((c) => owned.has(c.Id));
  if (
    !(await attempt({
      step: 'containers',
      verify: async () => !(await remaining()).length,
      execute: async () => {
        const live = await remaining();
        if (live.some((c) => !owned.get(c.Id) || owned.get(c.Id) !== labelsOf(c)[COMPOSE_PROJECT]))
          throw new Error('Container ownership changed');
        // Never -v: anonymous/external data has an independent preservation contract.
        if (live.length && !authorization)
          throw new Error('Container removal requires guarded disposable ownership');
        await authorization?.guard();
        if (live.length) {
          authorization!.effect();
          await docker(['rm', '-f', ...live.map((c) => c.Id)], SLOW);
          authorization!.settled();
        }
      },
    }))
  )
    return failures;
  for (const kind of ['network', 'volume', 'image'] as const) {
    // Fresh discovery at every barrier catches new objects; the original attachment list is not reused.
    for (const object of await inspectEnvironmentObjects(projects))
      observations.set(`${object.kind}:${object.id}`, object);
    authorization?.observe([...observations.values()]);
    for (const object of [...observations.values()].filter((item) => item.kind === kind)) {
      if (
        !(await attempt({
          step: `${kind}:${object.id}`,
          verify: async () => !(await exists(object)),
          execute: async () => {
            if (!authorization)
              throw new Error('Docker object retained: disposable provenance unavailable');
            const current = await inspectDockerObject(kind, object.id);
            if (!sameDockerObject(object, current)) {
              authorization.retained('docker_object_identity_changed');
              throw new Error('Docker object retained: docker_object_identity_changed');
            }
            await authorization.authorize(current);
            if (dockerObjectInUse(current, await inspectContainers())) {
              authorization.retained('docker_object_in_use');
              throw new Error('Docker object retained: docker_object_in_use');
            }
            // The awaited Docker inspection is followed by another lease/provenance check.
            const fresh = await inspectDockerObject(kind, current.id);
            if (!sameDockerObject(current, fresh)) {
              authorization.retained('docker_object_identity_changed');
              throw new Error('Docker object retained: docker_object_identity_changed');
            }
            await authorization.authorize(fresh);
            authorization.effect();
            await docker(
              kind === 'image' ? ['rmi', '--no-prune', current.id] : [kind, 'rm', current.id],
              SLOW,
            );
            authorization.settled();
          },
        }))
      )
        return failures;
    }
  }
  return failures;
}
