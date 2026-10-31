import { createInterface } from 'node:readline';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { operationTimeout, type BuiltinToolScope } from '@skaro/timeline';
import { processBirth, stopOwnedProcess } from '../process-identity.ts';
import type { RuntimeJournal } from '../journal.ts';
import { spawnCommandSupervisor } from './spawn-command.ts';
import type { ManagedProcess } from './process-model.ts';
import type { CommandEvent } from './command-protocol.ts';
import type { ToolArgs } from './schemas.ts';
import { outputPage } from './output-page.ts';
import { yieldProcess } from './process-yield.ts';

export class ToolProcesses {
  private readonly config: BuiltinToolScope;
  private readonly journal: RuntimeJournal;
  private readonly running = new Map<string, ManagedProcess>();
  constructor(config: BuiltinToolScope, journal: RuntimeJournal) {
    this.config = config;
    this.journal = journal;
  }

  async recover(): Promise<void> {
    for (const [id, record] of Object.entries(this.journal.state.processes)) {
      if (record.state !== 'running') continue;
      await stopOwnedProcess(record.owner);
      await this.journal.append(`process-recovered:${randomUUID()}`, [
        {
          type: 'process',
          id,
          owner: record.owner,
          state: 'interrupted',
          error: 'Previous runtime ended; command outcome is unknown',
        },
      ]);
    }
  }

  async exec(id: string, args: ToolArgs<'exec_command'>, cwd: string, signal: AbortSignal) {
    if (process.platform !== 'win32')
      throw new Error('Managed command containment is not implemented for this OS');
    if (args.shell && !['powershell', 'cmd'].includes(args.shell))
      throw new Error('Selected shell is unavailable on Windows');
    signal.throwIfAborted();
    await mkdir(this.config.artifactDir, { recursive: true });
    const child = spawnCommandSupervisor(this.config);
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    void ready.catch(() => undefined);
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    let resolveLaunched!: () => void;
    const launched = new Promise<void>((resolve) => {
      resolveLaunched = resolve;
    });
    let record: ManagedProcess | undefined;
    const exited = new Promise<void>((resolve) =>
      child.once('close', () => {
        rejectReady(new Error('Command supervisor exited before admission'));
        if (record) {
          if (!record.stopping && record.code === undefined)
            record.error ??= 'Command supervisor exited unexpectedly';
          record.resolveFinished();
        }
        resolve();
      }),
    );
    child.on('error', rejectReady);
    child.stdin.on('error', (error) => {
      rejectReady(error);
      if (record && !record.stopping) {
        record.error = error.message;
        void this.stop(id).catch(() => record!.resolveFinished());
      }
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => {
      try {
        const event = JSON.parse(line) as CommandEvent;
        if (event.type === 'ready') resolveReady();
        else if (record && event.type === 'launched') record.resolveLaunched();
        else if (record && event.type === 'exit') {
          record.code = event.code;
          record.signal = event.signal;
          void this.stop(id).catch((error: unknown) => {
            record!.error = String(error);
            record!.resolveFinished();
          });
        } else if (record && event.type === 'stdin') {
          const reply = record.replies.get(event.id);
          record.replies.delete(event.id);
          if (event.error) reply?.reject(new Error(event.error));
          else reply?.resolve();
        } else if (event.type === 'error') {
          rejectReady(new Error(event.error));
          if (record) {
            record.error = event.error;
            void this.stop(id).catch(() => record!.resolveFinished());
          }
        }
      } catch {
        rejectReady(new Error('Invalid command supervisor protocol'));
      }
    });
    const abort = () => {
      if (record) void this.stop(id).catch(() => undefined);
      else child.kill();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (!child.pid) throw new Error('Command supervisor failed to start');
      const birth = await processBirth(child.pid);
      if (!birth) throw new Error('Command supervisor exited before ownership was recorded');
      record = {
        child,
        owner: { pid: child.pid, birth, platform: process.platform },
        output: join(this.config.artifactDir, `${id}.output`),
        finished,
        resolveFinished,
        launched,
        resolveLaunched,
        replies: new Map(),
      };
      this.running.set(id, record);
      await this.journal.append(`process:${id}`, [
        { type: 'process', id, owner: record.owner, state: 'running' },
      ]);
      signal.throwIfAborted();
      await operationTimeout(ready, 15_000, 'Command Job Object setup timed out');
      signal.throwIfAborted();
      record.timer = setTimeout(() => {
        record!.error = 'Command timed out';
        void this.stop(id).catch(() => undefined);
      }, args.timeoutMs);
      child.stdin.write(
        JSON.stringify({
          type: 'run',
          command: args.command,
          cwd,
          shell: args.shell ?? 'powershell',
          outputPath: record.output,
        }) + '\n',
      );
      await operationTimeout(
        Promise.race([
          record.launched,
          record.finished.then(() => {
            if (record!.error) throw new Error(record!.error);
          }),
        ]),
        15_000,
        'Command launch timed out',
      );
      await yieldProcess(record.finished, args.yieldMs, signal);
      signal.throwIfAborted();
      return this.output(id, 0);
    } catch (error) {
      if (record) await this.stop(id);
      else {
        child.kill();
        await operationTimeout(exited, 5000, 'Unadmitted supervisor did not exit');
      }
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  async stdin(args: ToolArgs<'write_stdin'>, signal: AbortSignal) {
    const record = this.running.get(args.processId);
    if (!record) {
      if (args.chars !== undefined || args.end)
        throw new Error('Process stdin is unavailable in this runtime');
      signal.throwIfAborted();
      return this.output(args.processId, args.offset);
    }
    signal.throwIfAborted();
    if (args.chars !== undefined || args.end) {
      if (record.stopping || record.code !== undefined) throw new Error('Process stdin is closed');
      const id = randomUUID();
      const acknowledged = new Promise<void>((resolve, reject) =>
        record.replies.set(id, { resolve, reject }),
      );
      record.child.stdin.write(
        JSON.stringify({ type: 'stdin', id, chars: args.chars ?? '', end: args.end }) + '\n',
      );
      await operationTimeout(acknowledged, 5000, 'Stdin acknowledgement timed out');
    }
    await yieldProcess(record.finished, args.yieldMs, signal);
    signal.throwIfAborted();
    return this.output(args.processId, args.offset);
  }

  async output(id: string, offset: number) {
    const record = this.running.get(id);
    if (!record) {
      const archived = this.journal.state.processes[id];
      if (!archived || archived.state === 'running') throw new Error('Unknown process ID');
      return {
        processId: id,
        state: archived.state,
        ...(await outputPage(join(this.config.artifactDir, `${id}.output`), offset, true)),
        exitCode: archived.code ?? null,
        error: archived.error ?? null,
      };
    }
    return {
      processId: id,
      state: record.exited ? 'exited' : record.stopping ? 'stopping' : 'running',
      ...(await outputPage(record.output, offset, record.exited)),
      exitCode: record.code ?? null,
      error: record.error ?? null,
    };
  }

  stop(id: string): Promise<void> {
    const record = this.running.get(id);
    if (!record) {
      const archived = this.journal.state.processes[id];
      return archived && archived.state !== 'running'
        ? Promise.resolve()
        : Promise.reject(new Error('Unknown process ID'));
    }
    record.stopping ??= (async () => {
      clearTimeout(record.timer);
      await stopOwnedProcess(record.owner);
      await this.journal.append(`process-exited:${id}`, [
        {
          type: 'process',
          id,
          owner: record.owner,
          state: 'exited',
          code: record.code ?? null,
          ...(record.error ? { error: record.error } : {}),
        },
      ]);
      record.exited = true;
      for (const reply of record.replies.values()) reply.reject(new Error('Process stopped'));
      record.replies.clear();
      record.resolveFinished();
    })();
    return record.stopping;
  }
  async close(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }
}
