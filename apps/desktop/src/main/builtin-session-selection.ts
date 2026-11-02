import type { PermissionMode } from '@skaro/timeline';

export interface BuiltinSessionSelection {
  agent: 'skaro';
  model: string;
  effort?: string;
  permissionMode: PermissionMode;
}

/** Explicit main-only model choices shared by task/chat, without their workflow settings. */
export function parseBuiltinSessionSelection(value: unknown): BuiltinSessionSelection {
  const selected = value as Partial<BuiltinSessionSelection> | null;
  if (
    !selected ||
    typeof selected !== 'object' ||
    selected.agent !== 'skaro' ||
    Object.keys(selected).some(
      (key) => !['agent', 'model', 'effort', 'permissionMode'].includes(key),
    ) ||
    typeof selected.model !== 'string' ||
    !selected.model.trim() ||
    selected.model.length > 512 ||
    (selected.effort !== undefined &&
      (typeof selected.effort !== 'string' ||
        !selected.effort.trim() ||
        selected.effort.length > 64)) ||
    !['ask', 'auto', 'full'].includes(selected.permissionMode ?? '')
  )
    throw new Error('Builtin selection requires an exact route and explicit permissions');
  return {
    agent: 'skaro',
    model: selected.model,
    ...(selected.effort ? { effort: selected.effort } : {}),
    permissionMode: selected.permissionMode!,
  };
}
