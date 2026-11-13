import type { C4Audit } from '../../../shared/c4-audit';
import { auditActive } from '../../../shared/c4-audit';

class Audit {
  projectId = $state<string>();
  current = $state.raw<C4Audit>();
  busy = $state(false);
  error = $state('');
  private revision = 0;
  private watching = false;
  get active() {
    return !!this.current && auditActive(this.current.state);
  }
  scope(project?: string) {
    if (!this.watching) {
      this.watching = true;
      window.skaro.on('c4.auditChanged', ({ projectId }) => {
        if (projectId === this.projectId) void this.read();
      });
      window.skaro.on('project.changed', ({ projectId }) => {
        if (projectId === this.projectId) void this.read();
      });
    }
    if (this.projectId === project) return;
    this.revision++;
    this.projectId = project;
    this.current = undefined;
    this.error = '';
    this.busy = false;
    if (project) void this.read();
  }
  async read() {
    const project = this.projectId,
      revision = ++this.revision;
    if (!project) return;
    try {
      const current = await window.skaro.invoke('c4.audit', project);
      if (revision === this.revision) {
        this.current = current;
        this.error = '';
      }
    } catch (error) {
      if (revision === this.revision) this.error = String(error);
    }
  }
  async command(method: 'c4.auditStart' | 'c4.auditStop' | 'c4.auditRecover', id?: string) {
    const project = this.projectId;
    if (!project || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      const current =
        method === 'c4.auditStart'
          ? await window.skaro.invoke(method, project, id)
          : await window.skaro.invoke(method, project, id!);
      if (this.projectId === project) this.current = current;
    } catch (error) {
      if (this.projectId === project) this.error = String(error);
    } finally {
      if (this.projectId === project) this.busy = false;
    }
  }
}
export const audit = new Audit();
