import { isAgentId, diagnosticVersions } from '@skaro/agents';
import { projectRecords } from './project-records';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { type AppDb } from '@skaro/core';
import { isRunLogMeta, unknownShape, type TimelineEvent } from '@skaro/timeline';
import type { Diagnostics } from '../shared/diagnostics';
import { projectorFor } from './session-log';

/** Replay real logs through installed projectors, exporting only aggregate metadata. */
export async function collectDiagnostics(
  db: AppDb,
  dataDir: string,
  versions: { app: string; electron: string; node: string },
): Promise<Diagnostics> {
  const report: Diagnostics = {
    format: 1,
    createdAt: new Date().toISOString(),
    versions: { ...versions, ...diagnosticVersions() },
    platform: { os: process.platform, arch: process.arch },
    logs: { scanned: 0, unavailable: 0, invalidLines: 0, projectionErrors: 0 },
    unknownEvents: 0,
    unknown: [],
  };
  const counts = new Map<string, Diagnostics['unknown'][number]>();
  for await (const project of projectRecords(db)) {
    const records = [
      ...db.listRuns(project.id),
      ...db.listChats(project.id),
      ...db.listChats(project.id, { archived: true }),
    ];
    for (const record of records) {
      const path = resolve(dataDir, record.logPath);
      const rel = relative(resolve(dataDir), path);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
        report.logs.unavailable++;
        continue;
      }
      const seen = new Set<string>();
      let segment = 0;
      const emit = (event: TimelineEvent) => {
        if (event.t !== 'item.upsert' || event.item.kind !== 'unknown') return;
        const id = `${segment}/${event.item.id}`;
        if (seen.has(id)) return;
        seen.add(id);
        const agent = isAgentId(projectionAgent) ? projectionAgent : 'unknown';
        const typeHash = createHash('sha256').update(event.item.native.type).digest('hex');
        const key = `${agent}/${typeHash}`;
        const entry = counts.get(key) ?? {
          agent,
          typeHash,
          count: 0,
          shape: unknownShape(event.item.raw),
        };
        entry.count++;
        counts.set(key, entry);
        report.unknownEvents++;
      };
      let projectionAgent = record.agent;
      const makeProjector = async (id = projectionAgent, version?: string) =>
        (await projectorFor(id, version))(
          { now: () => 0, attachImage: () => ({ id: '', mime: '' }) },
          emit,
        );
      if (!isAgentId(projectionAgent)) {
        report.logs.unavailable++;
        continue;
      }
      let projector = await makeProjector();
      const input = createReadStream(path, { encoding: 'utf8' });
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line.trim()) continue;
          let raw;
          try {
            raw = JSON.parse(line);
          } catch {
            report.logs.invalidLines++;
            continue;
          }
          try {
            if (raw.dir === 'meta' && isRunLogMeta(raw.line)) {
              if (raw.line.skaro === 'segment') {
                segment++;
                projectionAgent = raw.line.agent;
                projector = await makeProjector(projectionAgent, raw.line.adapterVersion);
              } else if (raw.line.skaro === 'event') emit(raw.line.event);
            } else if (raw.dir === 'out') projector.output(raw.line);
            else if (raw.dir === 'in') projector.input(raw.line);
          } catch {
            report.logs.projectionErrors++;
          }
        }
        report.logs.scanned++;
      } catch {
        report.logs.unavailable++;
      } finally {
        lines.close();
        input.destroy();
      }
    }
  }
  report.unknown = [...counts.values()].sort((a, b) =>
    `${a.agent}/${a.typeHash}`.localeCompare(`${b.agent}/${b.typeHash}`),
  );
  return report;
}
