import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  RuntimeSession,
  type RuntimeExtensionHost,
  type JournalRecord,
} from '@skaro/agent-runtime';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import { longContextConfig } from '../credentials/long-context-config';

export async function extensionSession(
  directory: string,
  name: string,
  owner: RuntimeProcessIdentity,
  host?: RuntimeExtensionHost,
) {
  const config = longContextConfig(directory);
  config.sessionId = `extensions-${name}`;
  config.journalPath = join(directory, `${name}.jsonl`);
  config.tools!.readOnly = false;
  config.extensions = host?.tools.map(({ name, revision, readOnly }) => ({
    name,
    revision,
    readOnly,
  }));
  return RuntimeSession.open(config, owner, host);
}

/** The acceptance driver approves only these explicitly selected local operations. */
export async function approvedTool(
  session: RuntimeSession,
  id: string,
  name: string,
  args: unknown,
) {
  let interaction: string | undefined;
  let answer: Promise<JournalRecord> | undefined;
  const unsubscribe = session.journal.subscribe((record) => {
    for (const fact of record.facts) {
      if (fact.type !== 'interaction' || fact.interaction.kind !== 'approval') continue;
      assert.equal(fact.interaction.id, `approval-${id}`);
      assert.equal(session.journal.state.effects[id], undefined);
      interaction = fact.interaction.id;
      answer = session.execute({
        id: `approve-${id}`,
        action: {
          type: 'respond',
          interactionId: interaction,
          answer: { kind: 'approval', choice: 'allow_once' },
        },
      });
    }
  });
  try {
    const result = await session.execute({ id, action: { type: 'tool', name, args } });
    await answer;
    assert(!result.result.error, result.result.error);
    assert(interaction, 'Operation bypassed approval');
    return result.result.value as {
      text: string;
      isError?: boolean;
      artifacts?: { path: string; sha256: string; bytes: number }[];
    };
  } finally {
    unsubscribe();
  }
}
