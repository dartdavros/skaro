/** Refuse an unknown database before enabling WAL or executing a legacy writer. */
export function requireSupportedSchema(version: number, supported: number) {
  if (!Number.isSafeInteger(version) || version < 0 || version > supported)
    throw new Error(
      `Unsupported database schema ${version}; this build supports up to ${supported}. Preserve the database and use a compatible build.`,
    );
}
