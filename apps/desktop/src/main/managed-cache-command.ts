import { spawn } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { processBirth, stopOwnedProcess } from '@skaro/agent-runtime/process-identity';
import { resourceExecution } from './resource-execution';

/** No shell expansion, caller-provided command or raw stderr in the durable journal. */
export async function managedCacheCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    started?: (pid: number, birth?: string) => void;
    /** Local child close only; never evidence that a remote executor or descendant settled. */
    settled?: () => void;
    /** Host-only bounded progress observer; exceptions stop the supervised client. */
    stderr?: (chunk: Buffer) => void;
    /** Host-only error classifier; stdout is bounded and must not become a durable raw error. */
    failed?: (exitCode: number | null, stdout: string) => Error;
    timeoutMs?: number;
    maxOutput?: number;
    /** Host-only exact-identity teardown, not an agent-supplied escape from cancellation. */
    teardown?: boolean;
  },
): Promise<string> {
  const scope = options.teardown ? undefined : resourceExecution.getStore();
  await scope?.requireCurrent();
  const executable = await managedExecutable(command, options.env);
  await scope?.requireCurrent();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      failure: Error | undefined,
      stopping: Promise<void> | undefined;
    const identity = child.pid ? processBirth(child.pid) : Promise.resolve(undefined);
    const admission = identity.then((birth) => {
      if (child.pid) options.started?.(child.pid, birth);
    });
    const stop = () => {
      failure ??= new Error('managed_cache_command_cancelled_or_timed_out');
      stopping ??= identity.then(async (birth) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        if (!birth || !child.pid) throw new Error('managed_cache_child_identity_unavailable');
        await stopOwnedProcess({ pid: child.pid, birth, platform: process.platform });
      });
      void stopping.catch((error) => {
        failure = error instanceof Error ? error : new Error('managed_cache_child_stop_failed');
      });
    };
    const timer = setTimeout(stop, options.timeoutMs ?? 30 * 60_000);
    timer.unref();
    scope?.signal.addEventListener('abort', stop, { once: true });
    if (scope?.signal.aborted) stop();
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > (options.maxOutput ?? 1024 * 1024)) {
        failure = new Error('managed_cache_command_output_limit');
        stop();
      }
    });
    if (!options.stderr) child.stderr.resume();
    else
      child.stderr.on('data', (chunk: Buffer) => {
        try {
          options.stderr!(chunk);
        } catch {
          failure = new Error('managed_cache_command_progress_failed');
          stop();
        }
      }); // Durable errors remain stable codes, never raw registry/build output.
    child.once('error', () => {
      failure = new Error('managed_cache_command_start_failed');
    });
    void admission.catch(() => {
      failure = new Error('managed_cache_child_record_failed');
      stop();
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      scope?.signal.removeEventListener('abort', stop);
      void Promise.allSettled([admission, stopping]).then((results) => {
        try {
          options.settled?.();
          const rejected = results.find((result) => result.status === 'rejected');
          if (rejected?.status === 'rejected') reject(rejected.reason);
          else if (failure) reject(failure);
          else if (code !== 0)
            reject(options.failed?.(code, output) ?? new Error('managed_cache_command_failed'));
          else resolve(output.trim());
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

export async function managedExecutable(command: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (isAbsolute(command)) return realpath(command);
  if (!['git', 'docker'].includes(command)) throw new Error('managed_cache_untrusted_executable');
  for (const path of (env.PATH ?? env.Path ?? '')
    .split(delimiter)
    .filter((value) => isAbsolute(value))) {
    const file = join(path, process.platform === 'win32' ? `${command}.exe` : command);
    try {
      await access(file);
      return await realpath(file);
    } catch {
      /* Next explicit installed path only. */
    }
  }
  throw new Error('managed_cache_supported_executable_unavailable');
}
export function isolatedNpmEnvironment(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    TEMP: home,
    TMP: home,
    LANG: 'C',
    CI: 'true',
    NO_UPDATE_NOTIFIER: '1',
  };
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC'])
    if (process.env[key])
      env[key] = ['PATH', 'Path'].includes(key)
        ? process.env[key]!.split(delimiter)
            .filter((value) => isAbsolute(value))
            .join(delimiter)
        : process.env[key];
  return env;
}

/** Execute npm's JS entry with its actual Node, avoiding cmd.exe quoting and Electron-as-Node. */
export async function npmRuntime() {
  const paths = (process.env.PATH ?? process.env.Path ?? '')
    .split(delimiter)
    .filter((value) => isAbsolute(value));
  for (const path of paths) {
    const launcher = join(path, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    try {
      await access(launcher);
      const cli =
        process.platform === 'win32'
          ? join(path, 'node_modules', 'npm', 'bin', 'npm-cli.js')
          : await realpath(launcher);
      await access(cli);
      const node = join(path, process.platform === 'win32' ? 'node.exe' : 'node');
      await access(node);
      return { node: await realpath(node), cli: await realpath(cli), directory: dirname(cli) };
    } catch {
      /* Try another genuine installed npm/Node pair, never an arbitrary shell fallback. */
    }
  }
  throw new Error('managed_dependencies_supported_npm_runtime_unavailable');
}
