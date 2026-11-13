import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AppDb, GitSnapshot, ResourceRecord } from '@skaro/core';
import { cacheBudget, cacheEviction, type CacheCandidate } from './resource-cache-policy';
import {
  historyDigest,
  historyEntries,
  historyKey,
  newHistoryEntry,
  type HistoryEntry,
} from './history-file-metadata';
import { exportInfo, historyDirectory, publishExport } from './history-file-storage';
import { historyOutcome, historyResource, pinHistoryExport } from './history-file-records';
import { evictHistoryExport, historyEvictionOperation } from './history-file-eviction';

interface Inventory {
  project: string;
  dir: string;
  entries: HistoryEntry[];
}
interface Candidate {
  inventory: Inventory;
  entry: HistoryEntry;
  record: ResourceRecord;
  policy: CacheCandidate;
}
const pending = new Map<string, Promise<unknown>>();

/** Private immutable exports; one application-wide budget within the verification shell scope. */
export class HistoryFileCache {
  private readonly db: AppDb;
  private readonly dataDir: string;
  constructor(db: AppDb, dataDir: string) {
    this.db = db;
    this.dataDir = dataDir;
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const key = resolve(this.dataDir);
    const work = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
    pending.set(key, work);
    return work.finally(() => {
      if (pending.get(key) === work) pending.delete(key);
    });
  }
  private save(inventory: Inventory) {
    this.db.setSetting(historyKey(inventory.project), inventory.entries);
  }
  private async inventory(incomingProject?: string): Promise<Inventory[]> {
    const projects = new Set(this.db.listProjects().map((project) => project.id));
    // Include formerly registered projects with durable exports, without crossing the shell scope.
    for (const record of this.db.resources.list())
      if (record.kind === 'cache' && record.source?.recovery === 'git-blob-export-v2')
        projects.add(record.projectId);
    if (
      incomingProject &&
      (!projects.has(incomingProject) ||
        (this.db.shell.projectScope && incomingProject !== this.db.shell.projectScope))
    )
      throw new Error('Historical export project is outside the registered shell scope');
    const result: Inventory[] = [];
    for (const project of projects) {
      if (this.db.shell.projectScope && project !== this.db.shell.projectScope) continue;
      try {
        const entries = historyEntries(
          this.db.getSetting<unknown>(historyKey(project), [], { strict: true }),
        );
        if (!entries.length && project !== incomingProject) continue;
        const dir = await historyDirectory(this.dataDir, project);
        const known = new Set(
          entries.flatMap((entry) => [entry.name, ...(entry.pending ? [entry.pending] : [])]),
        );
        if ((await readdir(dir)).some((name) => !known.has(name)))
          throw new Error('Historical export directory contains unregistered files');
        result.push({ project, dir, entries });
      } catch (error) {
        const key = `history.inventory-retained.${project}`;
        if (!this.db.getSetting(key, false)) {
          this.db.addEvent(project, 'resource_cache_retained', {
            kind: 'history',
            objectId: historyKey(project),
            reason: 'export_inventory_unavailable',
          });
          this.db.setSetting(key, true);
        }
        throw error;
      }
    }
    return result;
  }
  async open(
    project: string,
    snapshot: GitSnapshot,
    path: string,
    launch: (path: string) => Promise<void>,
  ) {
    return this.serial(async () => {
      const bytes = await snapshot.read(path),
        proposed = newHistoryEntry(snapshot.commit, path, bytes);
      const inventories = await this.inventory(project);
      const inventory = inventories.find((value) => value.project === project)!;
      let selected: HistoryEntry | undefined;
      for (const entry of inventory.entries.filter(
        (entry) =>
          entry.identity === proposed.identity &&
          entry.digest === historyDigest(bytes) &&
          entry.bytes === bytes.length &&
          entry.phase !== 'retained',
      )) {
        const record = historyResource(this.db, project, inventory.dir, entry);
        if (record.state === 'released' || this.db.resources.cleanup.read(record.id)) continue;
        // Missing/partial legacy or already handed-off exports are never overwritten or silently adopted.
        if (entry.phase === 'writing') {
          await this.evict(inventories, 0, 0, record.id);
          if (await publishExport(inventory.dir, entry, bytes)) {
            entry.phase = 'ready';
            this.save(inventory);
          } else {
            entry.phase = 'retained';
            this.save(inventory);
            historyOutcome(this.db, record, 'retained', 'export_partial_or_changed');
            continue;
          }
        }
        const info = await exportInfo(join(inventory.dir, entry.name), entry);
        if (info.state === 'exact') {
          selected = entry;
          break;
        }
        historyOutcome(this.db, record, 'retained', `export_${info.state}`);
      }
      if (!selected) {
        await this.evict(inventories, bytes.length, 1);
        selected = proposed;
        // Durable journal and resource registration precede any filesystem writes.
        inventory.entries.push(selected);
        this.save(inventory);
        const record = historyResource(this.db, project, inventory.dir, selected);
        try {
          if (!(await publishExport(inventory.dir, selected, bytes)))
            throw new Error('Historical export publication path changed; retained for inspection');
          selected.phase = 'ready';
          this.save(inventory);
        } catch (error) {
          historyOutcome(this.db, record, 'failed', 'export_publication_interrupted');
          throw error;
        }
      }
      selected.usedAt = Date.now();
      this.save(inventory);
      const record = pinHistoryExport(
        this.db,
        historyResource(this.db, project, inventory.dir, selected),
      );
      historyOutcome(this.db, record, 'retained', 'external_history_consumer_unverified');
      // The OS handoff is not a lifetime signal. Even an error may have launched an external process.
      await launch(join(inventory.dir, selected.name));
    });
  }
  async sweep() {
    return this.serial(async () => {
      await this.evict(await this.inventory(), 0, 0);
    });
  }
  private async candidates(inventories: Inventory[]): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    for (const inventory of inventories)
      for (const entry of inventory.entries) {
        const record = historyResource(this.db, inventory.project, inventory.dir, entry);
        const target = await exportInfo(join(inventory.dir, entry.name), entry);
        const temporary = entry.pending
          ? await exportInfo(join(inventory.dir, entry.pending), entry)
          : undefined;
        const sameObject =
          target.info &&
          temporary?.info &&
          target.info.ino === temporary.info.ino &&
          target.info.dev === temporary.info.dev;
        const footprint = Math.max(
          entry.bytes,
          target.bytes + (sameObject ? 0 : (temporary?.bytes ?? 0)),
        );
        const immutable =
          entry.phase !== 'legacy' &&
          entry.phase !== 'retained' &&
          target.state !== 'changed' &&
          temporary?.state !== 'changed';
        candidates.push({
          inventory,
          entry,
          record,
          policy: {
            id: record.id,
            bytes: footprint,
            usedAt: entry.usedAt,
            consumers: record.consumers.length,
            ownership: record.ownership === 'registered' ? 'registered' : 'unknown',
            preservation: record.preservation === 'reproducible' ? 'reproducible' : 'unknown',
            immutable,
            secretsExcluded: true,
            privateScope: true,
          },
        });
      }
    return candidates;
  }
  private async evict(inventories: Inventory[], incoming: number, count: number, keep?: string) {
    const candidates = await this.candidates(inventories),
      budget = cacheBudget(this.db, 'history');
    // Reserve the incoming entry as well as bytes. The budget is shared, never reset per project.
    const plan = cacheEviction(
      candidates.map((candidate) => ({
        ...candidate.policy,
        consumers: candidate.policy.consumers + (candidate.record.id === keep ? 1 : 0),
      })),
      budget,
      Date.now(),
      incoming,
      count,
    );
    for (const retained of plan.retained) {
      const candidate = candidates.find((candidate) => candidate.record.id === retained.id)!;
      historyOutcome(this.db, candidate.record, 'retained', retained.reason.replaceAll('-', '_'));
    }
    // Interrupted exact cleanup is replayed independently of TTL/budget, never under a new identity.
    const retry = candidates
      .filter(
        (candidate) =>
          candidate.policy.immutable &&
          !candidate.policy.consumers &&
          candidate.record.id !== keep &&
          candidate.policy.ownership === 'registered' &&
          candidate.policy.preservation === 'reproducible' &&
          this.db.resources.cleanup.read(candidate.record.id)?.operationId ===
            historyEvictionOperation(candidate.record),
      )
      .map((candidate) => candidate.record.id);
    for (const id of new Set([...plan.remove, ...retry])) {
      const { inventory, entry, record } = candidates.find(
        (candidate) => candidate.record.id === id,
      )!;
      try {
        await evictHistoryExport(this.db, this.dataDir, inventory.project, entry, record, () => {
          inventory.entries = inventory.entries.filter((candidate) => candidate !== entry);
          this.save(inventory);
        });
      } catch {
        historyOutcome(this.db, record, 'retained', 'export_busy_or_changed');
      }
    }
    const remaining = await this.candidates(inventories);
    const total = remaining.reduce((sum, candidate) => sum + candidate.policy.bytes, incoming);
    if (
      !Number.isSafeInteger(total) ||
      total > budget.bytes ||
      remaining.length + count > budget.entries
    )
      throw new Error(
        'Historical export cache budget is exhausted; active or unknown consumers are retained',
      );
  }
}
