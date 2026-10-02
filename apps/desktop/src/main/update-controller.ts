import { AgentInstaller, type AgentId, type Platform } from '@skaro/core';
import type { UpdateState } from '../shared/updates';
import { changedComponents, newer, releasePlatform, type ReleaseManifest } from './update-release';
import { fetchRelease } from './update-feed';
import type { BundleVersions } from './update-current';
import { UpdateJournal, type PendingUpdate } from './update-journal';
import { verifyPayload } from './update-payload';
import type { UpdateActivity } from './update-activity';
import { prepareAgents, verifyAgents } from './update-agents';
import { recoveryDecision } from './update-recovery';

interface Deps {
  current: BundleVersions;
  platform: Platform;
  installer: AgentInstaller;
  journal: UpdateJournal;
  activity: UpdateActivity;
  installed: () => Promise<AgentId[]>;
  driver: {
    download: (manifest: ReleaseManifest, progress: (percent: number) => void) => Promise<string[]>;
    apply: () => void;
  };
  emit: (state: UpdateState) => void;
  fetch: typeof fetch;
  executable: string;
  installable: boolean;
}

/** Owns the only update state and serializes checks, downloads and explicit application. */
export class Updates {
  private state: UpdateState;
  private target?: ReleaseManifest;
  private pending?: PendingUpdate;
  private operation?: Promise<UpdateState>;
  private timer?: NodeJS.Timeout;
  private activityTimer?: NodeJS.Timeout;
  private unverified = false;
  private savingFailure = false;
  private readonly deps: Deps;
  constructor(deps: Deps) {
    this.deps = deps;
    this.state = {
      current: deps.current.skaroVersion,
      phase: 'idle',
      components: [],
      checked: false,
      busy: false,
      installable: deps.installable,
    };
  }
  snapshot(): UpdateState {
    return { ...this.state, busy: this.deps.activity.busy() };
  }
  private patch(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch };
    const next = this.snapshot();
    this.deps.emit(next);
    return next;
  }
  start(): void {
    if (this.state.phase !== 'error') void this.check();
    this.timer = setInterval(() => void this.check(), 6 * 60 * 60 * 1000);
    this.timer.unref();
    this.activityTimer = setInterval(() => {
      const busy = this.deps.activity.busy();
      if (busy !== this.state.busy) this.patch({ busy });
    }, 1000);
    this.activityTimer.unref();
  }
  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.activityTimer);
  }
  initialize(): Promise<UpdateState> {
    return this.run('check', async () => {
      try {
        await this.recover();
      } catch (error) {
        this.unverified = true;
        this.deps.activity.quarantine(true);
        throw error;
      }
      return this.snapshot();
    });
  }
  canRunAgents(): boolean {
    return !this.unverified;
  }
  applyFailed(error: Error): void {
    if (this.state.phase !== 'applying' || this.savingFailure) return;
    this.savingFailure = true;
    this.deps.activity.release();
    void (async () => {
      try {
        if (this.pending) {
          this.pending.applying = false;
          await this.deps.journal.save(this.pending);
        }
        this.fail(error, 'apply');
      } catch (failed) {
        this.fail(failed, 'apply');
      } finally {
        this.savingFailure = false;
      }
    })();
  }

  private async recover(): Promise<void> {
    const pending = await this.deps.journal.read();
    if (!pending) return;
    this.pending = pending;
    this.target = pending.manifest;
    const decision = recoveryDecision(pending, this.deps.current);
    if (decision !== 'resume') {
      this.unverified = true;
      this.deps.activity.quarantine(true);
      if (decision === 'unverified')
        throw new Error(
          'The applied bundle does not match the approved adapters and agent pins; restore the retained application',
        );
      await this.verifyAgents(pending);
      await this.deps.journal.confirm(pending);
      this.pending = undefined;
      this.target = undefined;
      this.unverified = false;
      this.deps.activity.quarantine(false);
      this.patch({
        phase: 'idle',
        components: [],
        error: undefined,
        retry: undefined,
        checked: true,
      });
      return;
    }
    const installed = [...new Set([...pending.agents, ...(await this.deps.installed())])];
    this.patch({
      components: changedComponents(pending.manifest, this.deps.current, installed),
      phase: 'available',
      checked: true,
    });
    if (pending.applying) {
      pending.applying = false;
      await this.deps.journal.save(pending);
      this.fail(
        new Error('The Skaro update was not applied; the previous application has been retained'),
        'download',
      );
    }
    // A new process must reinitialize electron-updater before it may apply a cached payload.
  }
  check(): Promise<UpdateState> {
    if (this.operation) return this.operation;
    if (this.unverified) return this.initialize();
    if (this.state.phase === 'ready' || this.state.phase === 'applying' || this.pending)
      return Promise.resolve(this.snapshot());
    return this.run('check', async () => {
      this.patch({ phase: 'checking', error: undefined });
      const next = await fetchRelease(this.deps.platform, this.deps.fetch);
      const installed = await this.deps.installed();
      const compatible =
        next &&
        newer(next.bundleVersion, this.deps.current.bundleVersion) &&
        (next.skaroVersion === this.deps.current.skaroVersion ||
          newer(next.skaroVersion, this.deps.current.skaroVersion));
      const components = compatible ? changedComponents(next, this.deps.current, installed) : [];
      this.target = components.length ? next : undefined;
      return this.patch({
        phase: components.length ? 'available' : 'idle',
        components,
        checked: true,
        retry: undefined,
      });
    });
  }
  download(): Promise<UpdateState> {
    if (this.operation) return this.operation;
    return this.run('download', async () => {
      if (!this.target || !this.state.components.length)
        throw new Error('No compatible update is available');
      if (!this.deps.installable) throw new Error('UPDATES_PACKAGED_ONLY');
      this.patch({ phase: 'downloading', error: undefined, progress: 0 });
      const selected = releasePlatform(this.target, this.deps.platform);
      const files = await this.deps.driver.download(this.target, (percent) =>
        this.patch({ progress: Math.round(percent * 0.7) }),
      );
      await verifyPayload(files, selected);
      const installed = [
        ...new Set([...(this.pending?.agents ?? []), ...(await this.deps.installed())]),
      ];
      await prepareAgents(
        this.deps.installer,
        this.target,
        this.deps.platform,
        installed,
        (percent) => this.patch({ progress: Math.round(percent) }),
      );
      this.pending = { manifest: this.target, agents: installed, files, applying: false };
      await this.verifyAgents(this.pending);
      await this.deps.journal.save(this.pending);
      return this.patch({ phase: 'ready', progress: 100, retry: undefined });
    });
  }
  apply(): Promise<UpdateState> {
    if (this.operation) return this.operation;
    return this.run('apply', async () => {
      if (!this.pending || (this.state.phase !== 'ready' && this.state.retry !== 'apply'))
        throw new Error('The update has not been verified');
      this.deps.activity.enterApply();
      try {
        this.patch({ phase: 'applying', error: undefined });
        await verifyPayload(
          this.pending.files,
          releasePlatform(this.pending.manifest, this.deps.platform),
        );
        await this.verifyAgents(this.pending);
        this.pending.backup ??= await this.deps.journal.backup(
          this.deps.current.bundleVersion,
          this.deps.executable,
          this.deps.platform,
        );
        this.pending.applying = true;
        await this.deps.journal.save(this.pending);
        if (this.deps.activity.busy()) throw new Error('UPDATE_BUSY');
        this.deps.driver.apply();
        return this.snapshot();
      } catch (error) {
        this.deps.activity.release();
        if (this.pending.applying) {
          this.pending.applying = false;
          await this.deps.journal.save(this.pending);
        }
        throw error;
      }
    });
  }
  private async verifyAgents(pending: PendingUpdate): Promise<void> {
    await verifyAgents(
      this.deps.installer,
      pending,
      this.deps.platform,
      await this.deps.installed(),
    );
  }
  private run(
    retry: 'check' | 'download' | 'apply',
    action: () => Promise<UpdateState>,
  ): Promise<UpdateState> {
    const operation = action()
      .catch((error) => this.fail(error, retry))
      .finally(() => {
        if (this.operation === operation) this.operation = undefined;
      });
    this.operation = operation;
    return operation;
  }
  private fail(error: unknown, retry: 'check' | 'download' | 'apply'): UpdateState {
    console.error('[updates]', error);
    if (error instanceof Error && error.message === 'UPDATE_BUSY')
      return this.patch({ phase: 'ready', busy: true, error: undefined });
    return this.patch({
      phase: 'error',
      error: error instanceof Error ? error.message : String(error),
      checked: true,
      retry,
    });
  }
}
