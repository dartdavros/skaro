import type { PnpmInstalledInventory } from './managed-pnpm-completeness';
import { pnpmBaseIdentity } from './managed-pnpm-graph-topology';

/** Node's file-before-directory lookup must not bypass verified dependency links. */
export function assertPnpmResolutionScopes(
  inventory: PnpmInstalledInventory,
  roots: ReadonlyMap<string, string>,
  links: ReadonlySet<string>,
  bins: ReadonlySet<string>,
  windows: boolean,
) {
  const key = (path: string) => (windows ? path.toLowerCase() : path);
  const allowed = new Set<string>([
    '',
    '.pnpm',
    '.pnpm/lock.yaml',
    '.modules.yaml',
    '.pnpm-workspace-state.json',
    '.bin',
  ]);
  const scopes = new Set<string>(['']);
  function permit(path: string) {
    const parts = key(path).split('/');
    for (let length = 1; length <= parts.length; length++)
      allowed.add(parts.slice(0, length).join('/'));
  }
  for (const path of [...links, ...bins]) permit(path);
  for (const [id, root] of roots) {
    permit(root);
    const { name } = pnpmBaseIdentity(id);
    scopes.add(key(root.slice(0, -(name.length + 1))));
    scopes.add(key(`${root}/node_modules`));
    permit(`${root}/node_modules/.bin`);
  }
  for (const [path, node] of inventory) {
    const normalized = key(path);
    let insidePayload = false;
    for (const root of roots.values()) {
      const prefix = `${key(root)}/`;
      if (!normalized.startsWith(prefix)) continue;
      insidePayload = true;
      const parts = normalized.slice(prefix.length).split('/');
      if (parts.includes('node_modules') && !allowed.has(normalized))
        throw new Error('managed_pnpm_graph_resolution_shadow');
    }
    // No unbound container/hoist fallback may participate in Node's ancestor search.
    if (!insidePayload && !allowed.has(normalized))
      throw new Error('managed_pnpm_graph_resolution_shadow');
    // Permitted intermediate resolution parents are directories, never executable files.
    if (allowed.has(normalized) && scopes.has(normalized) && node.type !== 'directory')
      throw new Error('managed_pnpm_graph_resolution_shadow');
  }
}
