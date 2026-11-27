import { ArtifactStore, type ConfigDefaults } from '@skaro/core';
import { ArtifactIndex } from './artifact-index';
import { artifactBytes } from './artifact-weight';
import type { PayloadStore } from './payload-store';

export function artifactWork(store: PayloadStore) {
  return async (
    root: string,
    defaults: ConfigDefaults,
    _revision: number,
    summary = false,
    includeC4 = false,
  ) => {
    const artifacts = await new ArtifactStore(
      root,
      () => defaults,
      () => [],
      new ArtifactIndex(store, root),
    ).load(summary, includeC4);
    const value = !summary
      ? artifacts
      : {
          ...artifacts,
          brief: artifacts.brief && { ...artifacts.brief, body: '' },
          architecture: artifacts.architecture && { ...artifacts.architecture, body: '' },
          docs: artifacts.docs.map((d) => ({ ...d, body: '' })),
          adrs: artifacts.adrs.map((d) => ({ ...d, body: '' })),
          specs: artifacts.specs.map((d) => ({ ...d, body: '' })),
          c4: undefined,
        };
    return { value, bytes: artifactBytes(value) };
  };
}
