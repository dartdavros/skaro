import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { c4Hash, type AppDb } from '@skaro/core';
import { resourceInventory } from './resource-workflow-observation';

const normalized = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
/** Keep host Docker lifecycle drift explicit; never silently ignore changed object identities. */
export async function auditRecoveryDocker(
  db: AppDb,
  project: string,
  root: string,
  directory: string,
) {
  const initialProof = JSON.parse(await readFile(join(directory, 'inspect-proof.json'), 'utf8'));
  const baselineProof = JSON.parse(
    await readFile(join(directory, 'docker-unavailable-proof.json'), 'utf8'),
  );
  const initial = initialProof.before.docker,
    baseline = baselineProof.before.docker;
  assert(initial.available && baseline.available);
  const now = await resourceInventory(root);
  for (const kind of ['images', 'volumes', 'networks'] as const)
    assert.deepEqual(normalized(now[kind]), baseline[kind], `Post-wake ${kind} changed`);
  assert.deepEqual(
    normalized(now.containers),
    baseline.containers.map((c: { id: string }) => c.id).sort(),
  );
  for (const kind of ['images', 'volumes'] as const)
    assert.deepEqual(initial[kind], baseline[kind]);
  assert.deepEqual(initial.containers, baseline.containers);
  const missing: string[] = initial.networks.filter(
    (id: string) => !baseline.networks.includes(id),
  );
  const added: string[] = baseline.networks.filter((id: string) => !initial.networks.includes(id));
  const evidence = [];
  if (missing.length || added.length) {
    assert.equal(missing.length, 1);
    assert.equal(added.length, 1);
    assert(!db.resources.list(project).some((r) => r.objectIds?.includes(missing[0]!)));
    const { stdout } = await promisify(execFile)('docker', ['network', 'inspect', added[0]!], {
      windowsHide: true,
      timeout: 20_000,
    });
    const network = JSON.parse(stdout)[0];
    assert.equal(network.Name, 'bridge');
    assert.equal(network.Options?.['com.docker.network.bridge.default_bridge'], 'true');
    assert(!Object.keys(network.Labels ?? {}).length);
    const logs = join(process.env['LOCALAPPDATA']!, 'Docker', 'log', 'host');
    const from = Date.parse(initialProof.startedAt),
      until = Date.parse(baselineProof.startedAt);
    for (const file of (await readdir(logs))
      .filter((f) => f.startsWith('monitor.log'))
      .slice(0, 20)) {
      const path = join(logs, file),
        bytes = await readFile(path);
      if (bytes.length > 2 * 1024 ** 2)
        throw new Error('Docker lifecycle log exceeds bounded reader');
      const lines = bytes
        .toString('utf8')
        .split(/\r?\n/)
        .filter((line) => {
          const timestamp = line.match(/^\[([^\]]+)\]/)?.[1],
            at = timestamp ? Date.parse(timestamp) : NaN;
          return (
            at >= from &&
            at <= until &&
            (/starting VM|state stopped -> starting/.test(line) ||
              (line.includes(missing[0]!) && line.includes('de-registering')) ||
              (line.includes(added[0]!) && line.includes('re-registering')))
          );
        });
      if (lines.length) evidence.push({ path, sourceHash: c4Hash(bytes.toString('utf8')), lines });
    }
    const facts = evidence.flatMap((e) => e.lines).join('\n');
    assert.match(facts, /starting VM/);
    assert(facts.includes(missing[0]!) && facts.includes(added[0]!));
  }
  return {
    postWakeObjectsPreserved: true,
    baselinePhase: 'docker-unavailable.before',
    initialInventoryUnchanged: missing.length === 0,
    initialNetworkDrift: {
      missing,
      added,
      evidence,
      newNetworkIsSystemDefaultBridge: added.length > 0,
      oldNetworkName: missing.length ? null : undefined,
      boundary:
        'Docker Desktop idle VM wake and resync observed; original opaque network name was not measured. No original-ID equality claim.',
    },
  };
}
