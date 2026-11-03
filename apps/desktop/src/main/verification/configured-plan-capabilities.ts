import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireRouteCapabilities } from '@skaro/timeline';
import type { BuiltinModelConfigurationStore } from '../builtin-model-configuration';
import { readConfiguredToolEvidence } from '../builtin-tool-evidence';
import { readConfiguredPlanPacket } from './configured-plan-packet';

/** Derive evidence from the real successful approved attempt, never write a verified flag by hand. */
export async function verifyConfiguredPlanCapabilities(
  store: BuiltinModelConfigurationStore,
  data: string,
  projectId: string,
  path: string,
  hash: string,
) {
  const reviewed = await readConfiguredPlanPacket(data, path, hash);
  await assert.rejects(readConfiguredPlanPacket(data, path, '0'.repeat(64)), {
    name: 'AssertionError',
  });
  await assert.rejects(readConfiguredPlanPacket(data, join(data, 'skaro.db'), hash), {
    name: 'AssertionError',
  });
  const configuration = store.read();
  const source = {
    journalPath: join(
      data,
      'verification/openrouter-ba4',
      `session-configured-${reviewed.attemptId}.jsonl`,
    ),
    sessionId: `configured-${reviewed.attemptId}`,
    inputRevision: hash,
    commandId: `configured-${hash.slice(0, 32)}`,
    route: reviewed.request.route,
    scope: {
      kind: 'task' as const,
      projectId,
      taskId: 'T-008',
      runId: 'verification-configured-plan-no-active-run',
    },
    requiredTools: ['inspect_acceptance', 'plan_checks', 'assess_checks'],
  };
  const digest = async () =>
    createHash('sha256')
      .update(await readFile(source.journalPath))
      .digest('hex');
  const before = await digest();
  const signal = new AbortController().signal;
  const evidence = await readConfiguredToolEvidence(store, source, signal);
  assert.equal(evidence.observed.length, 3);
  requireRouteCapabilities(source.route, evidence.assessment, ['tools']);
  for (const capability of [
    'images',
    'reasoning',
    'parallelTools',
    'cache',
    'compaction',
    'continuation',
  ] as const)
    assert.throws(
      () => requireRouteCapabilities(source.route, evidence.assessment, [capability]),
      /not verified/,
    );
  await assert.rejects(
    readConfiguredToolEvidence(
      store,
      { ...source, route: { ...source.route, routeRevision: source.route.routeRevision + 1 } },
      signal,
    ),
    /no longer current/,
  );
  await assert.rejects(
    readConfiguredToolEvidence(store, { ...source, inputRevision: 'unreviewed-input' }, signal),
    /differs/,
  );
  await assert.rejects(
    readConfiguredToolEvidence(
      store,
      { ...source, requiredTools: [...source.requiredTools, 'execute_command'] },
      signal,
    ),
    /No successful observed tool/,
  );
  assert.equal(await digest(), before);
  assert.deepEqual(store.read(), configuration);
  return {
    project: 'Cat-pilot',
    actualConfiguredEvidence: true,
    exactRouteAndInput: true,
    schemaAndExecutionLinked: true,
    onlyToolsVerified: true,
    unobservedOperationsRefused: true,
    staleRouteRefused: true,
    foreignInputRefused: true,
    missingToolRefused: true,
    wrongPacketHashRefused: true,
    outsidePacketRootRefused: true,
    sourceBytesUnchanged: true,
    configurationUnchanged: true,
    credentialBytesRead: false,
    modelRequests: 0,
    evidence,
  };
}
