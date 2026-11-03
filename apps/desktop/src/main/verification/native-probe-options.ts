import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { AttachmentStore } from '@skaro/core';
import type { RuntimeProcessIdentity, SessionOptions } from '@skaro/timeline';
import type { JournalRecord } from '@skaro/agent-runtime';
import { longContextConfig } from '../credentials/long-context-config';

export function nativeProbeConfig(directory: string, cwd: string, name: string, readOnly: boolean) {
  const config = longContextConfig(directory);
  config.sessionId = name;
  config.journalPath = join(directory, `${name}.jsonl`);
  config.context = undefined;
  config.tools = { cwd, readDirs: [], readOnly, artifactDir: join(directory, `${name}-artifacts`) };
  return config;
}

/** Actual OS owners and raw primary records from the native transport, never seeded history. */
export function nativeProbeOptions(directory: string, cwd: string, readOnly: boolean) {
  const owners: RuntimeProcessIdentity[] = [];
  const records = new Map<number, JournalRecord>();
  const options: SessionOptions = {
    cwd,
    permissionMode: 'ask',
    readOnly,
    context: new AttachmentStore(join(directory, 'native-attachments')).context(),
    raw(line) {
      const record = line.line as JournalRecord;
      if (record?.schema !== 2 || !record.sessionId || !record.hash) return;
      const previous = records.get(record.sequence);
      if (previous) assert.equal(previous.hash, record.hash);
      else records.set(record.sequence, record);
    },
    processStarted(pid, identity) {
      assert(identity);
      const owner = { pid, ...identity };
      appendFileSync(join(directory, 'native-owners.jsonl'), JSON.stringify(owner) + '\n');
      owners.push(owner);
    },
  };
  return { owners, records, options };
}
