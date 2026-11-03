import { createReadStream, type WriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import type { BuiltinJournalReplayBoundary, RawLine } from '@skaro/timeline';

/** Find actual copied records, not a counter advanced before a raw-log write. Runtime verifies the hash. */
export async function builtinJournalReplay(
  path: string,
  sessionId: string,
  writer?: WriteStream,
): Promise<{ boundary: BuiltinJournalReplayBoundary; needsSeparator: boolean }> {
  if (writer?.errored) throw writer.errored;
  if (writer && !writer.writableFinished) {
    if (writer.writableEnded) await finished(writer);
    else
      await new Promise<void>((resolve, reject) =>
        writer.write('', (error) => (error ? reject(error) : resolve())),
      );
  }
  const result = { sessionId, sequence: 0, hash: '' };
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let terminated = true;
  input.on('data', (chunk) => {
    terminated = typeof chunk === 'string' ? chunk.endsWith('\n') : chunk.at(-1) === 10;
  });
  try {
    for await (const text of lines) {
      if (Buffer.byteLength(text) > 67_108_864)
        throw new Error('Raw journal line exceeds its limit');
      let raw: RawLine;
      try {
        raw = JSON.parse(text) as RawLine;
      } catch {
        continue;
      }
      if (raw.dir !== 'out') continue;
      const record = raw.line as
        (Partial<BuiltinJournalReplayBoundary> & { schema?: number }) | null;
      if (record?.schema !== 2 || record.sessionId !== sessionId) continue;
      if (
        !Number.isSafeInteger(record.sequence) ||
        record.sequence! < 1 ||
        !/^[a-f0-9]{64}$/.test(record.hash ?? '')
      )
        throw new Error('Invalid copied primary journal reference');
      if (record.sequence === result.sequence && record.hash !== result.hash)
        throw new Error('Conflicting copied primary journal references');
      if (record.sequence! > result.sequence) {
        result.sequence = record.sequence!;
        result.hash = record.hash!;
      }
    }
    return { boundary: result, needsSeparator: !terminated };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { boundary: result, needsSeparator: false };
    throw error;
  } finally {
    lines.close();
    input.destroy();
  }
}
