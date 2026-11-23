import type { AppDb, Task } from '@skaro/core';
import { criteriaRevision } from './completion-store';

const key = (run: string) => `execution.${run}.acceptance-report`;

export function saveTaskAcceptanceReport(db: AppDb, run: string, task: Task, report: object) {
  db.setSetting(key(run), { revision: criteriaRevision(task), report });
}

export function taskAcceptanceNote(db: AppDb, run: string, task: Task): string {
  const record = db.getSetting<{ revision: string; report: object } | null>(key(run), null);
  if (record?.revision !== criteriaRevision(task)) return '';
  return (
    '\n\nThe last submission report is historical evidence. Verify current inputs before relying on it.\n' +
    JSON.stringify(record.report).slice(0, 8000)
  );
}
