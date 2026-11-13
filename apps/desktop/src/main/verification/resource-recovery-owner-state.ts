import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { c4Hash, type AppDb } from '@skaro/core';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

/** Compare the actual preflight decision rows, including outcomes; disclose hashes, never answer text. */
export async function verifyResourceOwnerDecisions(db: AppDb, project: string) {
  const proof = JSON.parse(await readFile(process.env['SKARO_RC4_PREFLIGHT']!, 'utf8'));
  assert.equal(
    createHash('sha256')
      .update(await readFile(proof.backup.path))
      .digest('hex'),
    proof.backup.sha256,
  );
  const backup = new DatabaseSync(proof.backup.path, { readOnly: true });
  try {
    const rows = backup
      .prepare(
        "SELECT * FROM coordination_entities WHERE project_id=? AND kind='decision' ORDER BY id",
      )
      .all(project);
    const before = rows.map((row) => {
      const expected = {
        ...JSON.parse(String(row.value)),
        state: row.state,
        ...(row.evidence === null ? {} : { evidence: JSON.parse(String(row.evidence)) }),
        revision: Number(row.revision),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      };
      assert(
        isDeepStrictEqual(db.coordination.decisions.get(project, String(row.id)), expected),
        `Owner decision ${String(row.id)} changed`,
      );
      return { id: String(row.id), hash: c4Hash(JSON.stringify(expected)) };
    });
    const after = db.coordination.decisions
      .list(project)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((row) => row.id);
    assert.deepEqual(
      after,
      before.map((row) => row.id),
      'Owner decisions and outcomes must survive resource/model failure',
    );
    return { count: before.length, sha256: c4Hash(JSON.stringify(before)), unchanged: true };
  } finally {
    backup.close();
  }
}
