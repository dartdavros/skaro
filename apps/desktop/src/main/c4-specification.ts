import { parseMarkdown, serializeMarkdown, setFields, slugify, readC4Model } from '@skaro/core';
import type { ProposeSpecArgs, SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { Projects } from './projects';
import type { C4Service } from './c4-service';

/** The specification entry point composes the same package service; there is no second save path. */
export async function proposeC4Specification(
  service: C4Service,
  projects: Projects,
  args: ProposeSpecArgs,
  scope: SkaroScope,
): Promise<ToolResult> {
  if (!args.c4)
    return {
      isError: true,
      text: 'Specifications require c4 (base_revision, model, documents). Read get_c4_context or use propose_c4 for the complete package.',
    };
  const artifacts = await projects.get(scope.projectId).load();
  const id =
    args.id?.replace(/^SPEC-/i, '').padStart(4, '0') ??
    String(Math.max(0, ...artifacts.specs.map((s) => Number(s.id))) + 1).padStart(4, '0');
  const previous = artifacts.specs.find((s) => s.id === id);
  if (args.id && !previous) return { isError: true, text: `Unknown SPEC-${id}` };
  const title = args.title ?? previous?.title;
  if (!title) return { isError: true, text: 'A specification title is required' };
  const path = previous?.path.replace(/^\.skaro\//, '') ?? `specs/${id}-${slugify(title)}.md`;
  const documents = [...args.c4.documents];
  if (previous) {
    if (
      args.content !== undefined ||
      args.title ||
      args.replaces ||
      !documents.some((doc) => doc.path === path && doc.edits !== undefined)
    )
      return {
        isError: true,
        text: `Edit ${path} in c4.documents with base_hash and exact edits, including any frontmatter changes.`,
      };
  } else {
    if (!args.content?.trim()) return { isError: true, text: 'A new specification needs content.' };
    const file = parseMarkdown(args.content);
    setFields(file, {
      id,
      title,
      status: 'accepted',
      date: new Date().toISOString().slice(0, 10),
      ...(args.replaces ? { replaces: args.replaces } : {}),
    });
    documents.push({ path, content: serializeMarkdown(file) });
  }
  const model = structuredClone(readC4Model(args.c4.model));
  const binding = model.specifications.find((s) => s.id === id);
  if (!binding)
    return { isError: true, text: `C4 model must include requirement coverage for SPEC-${id}` };
  binding.path = path;
  return service.propose(
    {
      title: `SPEC-${id} · ${title}`,
      summary: args.summary ?? title,
      baseRevision: args.c4.baseRevision,
      model,
      documents,
    },
    scope,
  );
}
