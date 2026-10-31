import type { ChatRequest, RuntimeSession } from '@skaro/agent-runtime';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Acceptance-only spend envelope: at most sixteen requests, each reserved at $0.05 (< $1 total).
 * Unknown outcomes retain their reservation; reruns use the same durable journal. */
export async function admitLiveRequest(
  session: RuntimeSession,
  request: ChatRequest,
): Promise<void> {
  const directory = dirname(session.journal.state.config!.journalPath);
  let intents = 0;
  for (const name of await readdir(directory)) {
    if (!/^session(?:-[a-z]+)?\.jsonl$/.test(name)) continue;
    const lines = (await readFile(join(directory, name), 'utf8')).trim().split('\n');
    for (const line of lines) {
      const record = JSON.parse(line) as { facts: { type: string; name?: string }[] };
      intents += record.facts.filter(
        (fact) => fact.type === 'effect-intent' && fact.name === 'model:chat',
      ).length;
    }
  }
  if (
    intents > 16 ||
    request.price.prompt > 0.5 ||
    request.price.completion > 2 ||
    Number(request.route.parameters.max_tokens) > 512 ||
    Buffer.byteLength(JSON.stringify(request)) > 16_384
  )
    throw new Error('Live acceptance budget envelope exhausted');
  // 16,384 input bytes + generous 4,096 template tokens at $0.50/M and 512 output
  // tokens at $2/M stay below the $0.05 reservation. No server tools/request fees.
}
