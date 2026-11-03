import type { PathScope } from '../tools/path-scope.ts';
import { readScopedFile, decodeText } from '../tools/text-file.ts';
import { parse } from 'yaml';

/** Host-selected skills only; unrelated profiles and implicit permission grants are excluded. */
export async function inspectSkill(
  scope: PathScope,
  input: { id: string; path: string },
  signal: AbortSignal,
) {
  if (!input.id || !/(^|[\\/])SKILL\.md$/.test(input.path))
    throw new Error('Skill entry must reference SKILL.md');
  const file = await readScopedFile(scope, input.path, signal);
  const text = decodeText(file.bytes).text;
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!frontmatter) throw new Error('Skill metadata is missing');
  let metadata: Record<string, unknown>;
  try {
    metadata = parse(frontmatter[1]!, { maxAliasCount: 0, uniqueKeys: true }) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error('Skill metadata is invalid');
  }
  const scalar = (name: string) => {
    const value = metadata?.[name];
    if (typeof value !== 'string' || !value.trim() || value.length > 4096)
      throw new Error('Skill requires a scalar name and description');
    return value;
  };
  return {
    id: input.id,
    path: input.path,
    revision: file.hash,
    name: scalar('name'),
    description: scalar('description'),
  };
}
