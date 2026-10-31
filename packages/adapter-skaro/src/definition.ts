import { BUILTIN_CONTRACT_VERSIONS } from '@skaro/timeline';
import type { BundledAgentRegistration } from '@skaro/timeline';
import packageManifest from '../package.json' with { type: 'json' };

export const skaroDefinition = {
  id: 'skaro',
  stage: 'runtime-core',
  delivery: {
    kind: 'bundled',
    runtimePackage: '@skaro/agent-runtime',
    versioning: 'with-skaro',
    contracts: BUILTIN_CONTRACT_VERSIONS,
  },
  unavailableReason: 'model-host-not-connected',
  package: packageManifest,
  adapterVersion: packageManifest.version,
  async loadSessionRuntime() {
    const { SkaroSession } = await import('./session.ts');
    return { start: SkaroSession.start };
  },
  async loadProjector() {
    const { SkaroProjector } = await import('@skaro/agent-runtime');
    return (_context, emit, adapterVersion) => {
      if (adapterVersion && adapterVersion !== packageManifest.version)
        throw new Error(`Unsupported Skaro adapter projection version: ${adapterVersion}`);
      return new SkaroProjector(emit);
    };
  },
} as const satisfies BundledAgentRegistration;
