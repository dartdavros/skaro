// "Проверить обновления" ("Настройки" → "О программе"): the latest release on GitHub. Asked only
// when the user clicks; installing the update arrives with auto-update (plan: stage 8).

import { net } from 'electron';
import type { UpdateInfo } from '../shared/ipc';

const RELEASES = 'https://api.github.com/repos/skarodev/skaro/releases/latest';

/** "2.1.0" > "2.0.3". */
export function newer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split(/[.-]/)
      .map((x) => Number(x) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function checkUpdate(current: string): Promise<UpdateInfo> {
  const response = await net.fetch(RELEASES, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub: ${response.status}`);
  const release = (await response.json()) as { tag_name?: string; html_url?: string };
  const latest = release.tag_name?.replace(/^v/, '');
  if (!latest || !newer(latest, current)) return { current };
  return { current, latest, ...(release.html_url ? { url: release.html_url } : {}) };
}
