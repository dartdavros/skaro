import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import { BuiltinModelConfigurationStore } from '../builtin-model-configuration';
import { verifyConfiguredPlanCapabilities } from './configured-plan-capabilities';

// Real SQLite and completed primary journal. No Electron app/services/vault/network are started.
const data = join(process.env.APPDATA!, 'Skaro');
const db = AppDb.readOnly(join(data, 'skaro.db'));
try {
  const projects = db.shell.list().filter((entry) => entry.name.toLowerCase() === 'cat-pilot');
  assert.equal(projects.length, 1);
  db.shell.scopeTo(projects[0]!.id);
  const proof = await verifyConfiguredPlanCapabilities(
    new BuiltinModelConfigurationStore(db),
    data,
    projects[0]!.id,
    process.argv[2]!,
    process.argv[3]!,
  );
  const directory = join(data, 'verification', `tool-evidence-${randomUUID()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, 'proof.json'),
    JSON.stringify(
      {
        readonlyDatabase: true,
        projectServicesStarted: false,
        credentialVaultOpened: false,
        networkRequests: 0,
        ...proof,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ type: 'tool-evidence', directory, proof }));
} catch (error) {
  console.log(
    JSON.stringify({
      type: 'failed',
      stage: 'tool-evidence',
      name: error instanceof Error ? error.name : 'Error',
    }),
  );
  process.exitCode = 1;
} finally {
  db.close();
}
