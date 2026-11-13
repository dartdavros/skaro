import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { pnpmPrivatePath } from './managed-pnpm-layout';

const inherited = new Set(['$NODE_PATH', '%NODE_PATH%', '$env_node_path']);
const composed = new Set(['$new_node_path', '$new_node_path$pathsep$env_node_path']);

/** Parse only generated NODE_PATH bindings; a POSIX separator is never a Windows drive. */
export function assertPnpmNodePaths(root: string, shim: string, text: string): void {
  const assignments = text.matchAll(/(?:\bNODE_PATH|\$new_node_path)\s*=\s*["']?([^"'\r\n]*)/g);
  for (const match of assignments) {
    const value = match[1]!;
    if (composed.has(value)) continue;
    const windows = /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('%~dp0');
    for (const path of value.split(windows ? ';' : ':')) {
      if (inherited.has(path)) continue;
      const relative = /^(?:\$basedir|%~dp0|\$PSScriptRoot)([\\/].*)$/.exec(path);
      if (relative) {
        pnpmPrivatePath(
          root,
          resolve(dirname(shim), relative[1]!.replaceAll('\\', sep).replaceAll('/', sep).slice(1)),
        );
        continue;
      }
      // Windows pnpm also emits a WSL branch in its sh/PowerShell wrappers.
      const wsl = /^\/mnt\/([a-z])\/(.*)$/i.exec(path);
      const native = process.platform === 'win32' && wsl ? `${wsl[1]}:/${wsl[2]}` : path;
      if (!isAbsolute(native) || /[$%`]/.test(native))
        throw new Error('managed_pnpm_shim_unsupported');
      pnpmPrivatePath(root, native);
    }
  }
}
