import type { AppDb } from '@skaro/core';
import type { ProjectContext } from './projects';
import { observeC4Impact } from './c4-impact-observation';
import { c4SemanticContext, c4SemanticContextHash } from './c4-semantic-context';
import { c4SemanticFingerprint } from './c4-semantic-result';
import { inspectC4Preservation } from './c4-preservation';

export async function c4SemanticSnapshot(
  db: AppDb,
  context: ProjectContext,
  task: string,
  run: string,
  dispatched = true,
) {
  const observation = await observeC4Impact(db, context, task, run, {
    requireDispatchInputs: dispatched,
  });
  const artifacts = await context.store.load();
  const preservation = await inspectC4Preservation(
    observation.impact.checkout,
    observation.impact.baseHead,
    observation.scope,
    { root: context.root, model: artifacts.c4 },
  );
  const semantic = { ...c4SemanticContext(artifacts, task, observation.scope), preservation };
  const contextHash = c4SemanticContextHash(semantic);
  return {
    observation,
    semantic,
    preservation,
    contextHash,
    fingerprint: c4SemanticFingerprint(observation, contextHash),
  };
}
