import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

/** Official Desktop default disk locations; customized/ambiguous storage needs an explicit path. */
export async function dockerStorageLocation(
  info: { OperatingSystem?: string; DockerRootDir?: string },
  endpoint: string,
  configured?: string,
): Promise<string | undefined> {
  const local =
    process.platform === 'win32'
      ? endpoint === 'npipe:////./pipe/dockerDesktopLinuxEngine'
      : endpoint.startsWith('unix://');
  if (!local) return undefined;
  if (configured) return realpath(configured);
  if (!String(info.OperatingSystem).includes('Docker Desktop'))
    return process.platform === 'linux' ? info.DockerRootDir : undefined;
  const home = app.getPath('home');
  const settingsPath =
    process.platform === 'win32'
      ? join(app.getPath('appData'), 'Docker/settings-store.json')
      : process.platform === 'darwin'
        ? join(home, 'Library/Group Containers/group.com.docker/settings-store.json')
        : join(home, '.docker/desktop/settings-store.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
  if (
    Object.entries(settings).some(
      ([key, value]) =>
        /datafolder|diskimagelocation/i.test(key) && typeof value === 'string' && value.trim(),
    )
  )
    return undefined;
  const localData = process.env.LOCALAPPDATA ?? join(home, 'AppData/Local');
  const defaults =
    process.platform === 'win32'
      ? [
          join(localData, 'Docker/wsl/disk/docker_data.vhdx'),
          join(
            process.env.ProgramData ?? 'C:/ProgramData',
            'DockerDesktop/vm-data/DockerDesktop.vhdx',
          ),
          join(localData, 'Docker/vm-data/DockerDesktop.vhdx'),
        ]
      : [
          process.platform === 'darwin'
            ? join(home, 'Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw')
            : join(home, '.docker/desktop/vms/0/data/Docker.raw'),
        ];
  const found: string[] = [];
  for (const path of defaults) {
    try {
      if ((await stat(path)).isFile()) found.push(await realpath(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return found.length === 1 ? found[0] : undefined;
}
