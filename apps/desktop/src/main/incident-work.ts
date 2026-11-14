import type { CoordinationBlocker } from '@skaro/core';

/** Only work entered by this process is running; admission and restart recovery remain queued. */
export class IncidentWork {
  private readonly active = new Set<string>();
  private readonly changed: (projectId: string, incidentId: string) => void;
  constructor(changed: (projectId: string, incidentId: string) => void) {
    this.changed = changed;
  }

  running(projectId: string, incidentId: string): boolean {
    return this.active.has(JSON.stringify([projectId, incidentId]));
  }

  start(row: Pick<CoordinationBlocker, 'projectId' | 'id'>): () => void {
    const key = JSON.stringify([row.projectId, row.id]);
    this.active.add(key);
    try {
      this.changed(row.projectId, row.id);
    } catch (error) {
      this.active.delete(key);
      throw error;
    }
    return () => {
      if (this.active.delete(key)) this.changed(row.projectId, row.id);
    };
  }
}
