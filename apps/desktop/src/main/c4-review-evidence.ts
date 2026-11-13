import { readFile } from 'node:fs/promises';
import { c4Hash } from '@skaro/core';
import type { C4SemanticJob } from './c4-semantic-store';

export async function requireC4ReviewEvidence(job: C4SemanticJob) {
  if (
    !job.reviewer ||
    !job.worker ||
    job.reviewer.worker !== job.worker ||
    !job.reviewer.nativeSessionId ||
    c4Hash(await readFile(job.reviewer.log, 'utf8')) !== job.reviewer.logHash
  )
    throw new Error('Independent C4 review durable evidence is missing or changed');
}
