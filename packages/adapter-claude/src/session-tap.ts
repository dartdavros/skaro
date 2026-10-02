import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { type SpawnedProcess, type SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { type SessionOptions } from '@skaro/timeline';
import { ClaudeProjector } from './projector.ts';
import { lines, parse } from './session-helpers.ts';

export function spawnTapped(
  options: SpawnOptions,
  optionsOfSession: SessionOptions,
  projector: ClaudeProjector,
  track: (line: unknown) => void,
): SpawnedProcess {
  const raw = optionsOfSession.raw;
  const now = () => optionsOfSession.context.now();
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const stdin = new PassThrough();
  stdin.on(
    'data',
    lines((line) => {
      const msg = parse(line);
      raw({ ts: now(), dir: 'in', line: msg });
      projector.input(msg);
    }),
  );
  stdin.pipe(child.stdin);

  const stdout = new PassThrough();
  child.stdout.on(
    'data',
    lines((line) => {
      const msg = parse(line);
      raw({ ts: now(), dir: 'out', line: msg });
      track(msg);
      projector.output(msg);
      stdout.write(`${line}\n`);
    }),
  );
  child.stdout.on('end', () => stdout.end());
  child.stderr.on(
    'data',
    lines((line) => raw({ ts: now(), dir: 'err', line })),
  );

  return {
    stdin,
    stdout,
    get killed() {
      return child.killed;
    },
    get exitCode() {
      return child.exitCode;
    },
    get signalCode() {
      return child.signalCode;
    },
    kill: (signal: NodeJS.Signals) => child.kill(signal),
    on: (event: string, listener: (...args: unknown[]) => void) => void child.on(event, listener),
    once: (event: string, listener: (...args: unknown[]) => void) =>
      void child.once(event, listener),
    off: (event: string, listener: (...args: unknown[]) => void) => void child.off(event, listener),
  } as unknown as SpawnedProcess;
}
