/** Explicit OS allowlist shared by runtime and command workers; no inherited API/auth env. */
export function cleanCommandEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    'path',
    'systemroot',
    'windir',
    'pathext',
    'comspec',
    'temp',
    'tmp',
    'tmpdir',
    'lang',
    'lc_all',
    'lc_ctype',
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())),
  );
}
