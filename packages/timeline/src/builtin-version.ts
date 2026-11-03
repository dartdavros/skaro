/** Independent wire/storage formats; not the public release manifest schema. */
export const BUILTIN_CONTRACT_VERSIONS = Object.freeze({
  host: 1,
  events: 1,
  journal: 2,
  projector: 1,
});

export type BuiltinContractVersions = {
  readonly [K in keyof typeof BUILTIN_CONTRACT_VERSIONS]: number;
};

/** No best-effort decoding of unknown journal/events or cross-version host calls. */
export function requireBuiltinCompatibility(versions: BuiltinContractVersions): void {
  for (const key of Object.keys(BUILTIN_CONTRACT_VERSIONS) as (keyof BuiltinContractVersions)[]) {
    if (versions[key] !== BUILTIN_CONTRACT_VERSIONS[key])
      throw new Error(`Unsupported builtin ${key} version: ${versions[key]}`);
  }
}
