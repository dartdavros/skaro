import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TimelineEvent } from '@skaro/timeline';

/** Values, identifiers, timestamps and stream chunk counts do not enter structural signatures. */
function shape(value: unknown): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => JSON.stringify(shape(v))))].sort();
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, shape(entry)]),
    );
  }
  return typeof value;
}

export function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(shape(value)))
    .digest('hex');
}

export function changes(before: readonly string[], after: readonly string[]) {
  return {
    added: after.filter((s) => !before.includes(s)),
    removed: before.filter((s) => !after.includes(s)),
  };
}

export function summarize(events: readonly TimelineEvent[]) {
  const signatures = new Set<string>();
  const unknown = new Set<string>();
  const kinds = new Set<string>();
  const outcomes = { done: 0, failed: 0, interrupted: 0 };
  let finalAnswer = false;
  for (const e of events) {
    // Fixed model enums distinguish structurally identical command/explore and interaction types.
    const category =
      e.t === 'item.upsert' ? e.item.kind : e.t === 'interaction.opened' ? e.interaction.kind : '';
    signatures.add(
      createHash('sha256')
        .update(`${e.t}/${category}/${fingerprint(e)}`)
        .digest('hex'),
    );
    if (e.t === 'turn.completed') outcomes[e.outcome]++;
    if (e.t === 'item.upsert') {
      kinds.add(e.item.kind);
      if (e.item.kind === 'unknown') unknown.add(e.item.id);
      if (e.item.kind === 'message' && e.item.role === 'agent' && e.item.text.trim())
        finalAnswer = true;
    }
  }
  return {
    events: events.length,
    unknown: unknown.size,
    outcomes,
    finalAnswer,
    kinds: [...kinds].sort(),
    signatures: [...signatures].sort(),
  };
}

export function recordingReport(dir: string, baseline?: string) {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { error?: string };
  const current = summarize(recordingEvents(dir));
  const reference =
    baseline && existsSync(join(baseline, 'canonical.jsonl'))
      ? summarize(recordingEvents(baseline))
      : undefined;
  const ok =
    !meta.error &&
    current.outcomes.done > 0 &&
    current.outcomes.failed === 0 &&
    current.outcomes.interrupted === 0 &&
    current.unknown === 0 &&
    current.finalAnswer;
  return {
    ok,
    recordingError: Boolean(meta.error),
    ...current,
    canonicalChanges: reference ? changes(reference.signatures, current.signatures) : null,
  };
}

export function recordingEvents(dir: string): TimelineEvent[] {
  return readFileSync(join(dir, 'canonical.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TimelineEvent);
}

/** Windows Codex may read via a command; its actual fixture contents must be present. */
export function readPerformed(events: readonly TimelineEvent[]): boolean {
  return events.some((event) => {
    if (event.t !== 'item.upsert' || event.item.status !== 'done') return false;
    const item = event.item;
    return (
      (item.kind === 'explore' && item.op === 'read') ||
      (item.kind === 'command' &&
        item.exitCode === 0 &&
        item.output.includes('export function add') &&
        item.output.includes('Tiny calculator'))
    );
  });
}
