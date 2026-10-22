import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';

export interface ProposeC4Args {
  title: string;
  summary: string;
  baseRevision: number;
  model: unknown;
  documents: { path: string; content: string }[];
}
export interface ReviewC4Args {
  realized: string[];
  revision: number;
  changeHash: string;
  elements: string[];
  relationships: string[];
  evidence: string;
  aligned: boolean;
}
export interface C4Handlers {
  context(scope: SkaroScope): Promise<ToolResult>;
  propose(args: ProposeC4Args, scope: SkaroScope): Promise<ToolResult>;
  review(args: ReviewC4Args, scope: SkaroScope): Promise<ToolResult>;
  migrate?(scope: SkaroScope): Promise<ToolResult>;
}

export function c4Tools(handlers: C4Handlers): Tool<SkaroScope>[] {
  const available = (scope: SkaroScope) => scope.kind === 'task' || scope.kind === 'project_chat';
  const call =
    <T>(
      parse: (args: Record<string, unknown>) => T,
      handler: (args: T, scope: SkaroScope) => Promise<ToolResult>,
    ) =>
    async (args: Record<string, unknown>, scope: SkaroScope) => {
      try {
        return await handler(parse(args), scope);
      } catch (error) {
        return { text: error instanceof Error ? error.message : String(error), isError: true };
      }
    };
  const text = (args: Record<string, unknown>, key: string) => {
    const value = args[key];
    if (typeof value !== 'string' || !value.trim())
      throw new Error(`${key} must be non-empty text`);
    return value;
  };
  const integer = (args: Record<string, unknown>, key: string) => {
    const value = args[key];
    if (!Number.isSafeInteger(value) || Number(value) < 0)
      throw new Error(`${key} must be a non-negative integer`);
    return Number(value);
  };
  const refs = (args: Record<string, unknown>, key: string) => {
    const value = args[key];
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim()))
      throw new Error(`${key} must be string identifiers`);
    return value as string[];
  };
  return [
    {
      name: 'migrate_c4_documents',
      available: (scope) => scope.kind === 'project_chat' && !scope.importId && !!handlers.migrate,
      description:
        'Prepare an owner-reviewed format-only package removing legacy embedded C4 copies from Markdown documents. Preserves authored content, architecture and requirement coverage. No files change before acceptance. Resolve all pending architecture packages first. Run only when the owner requests this migration.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      call: call(
        () => undefined,
        (_args, scope) => handlers.migrate!(scope),
      ),
    },
    {
      name: 'get_c4_context',
      available,
      description:
        'Read the shared C4 model, its exact JSON schema, document sources, coverage problems, pending architecture packages and the current task change fingerprint. Call before preparing architecture/specifications or reviewing implementation. Absence of C4 is an explicit documentation gap, not verified coverage.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      call: (_args, scope) => handlers.context(scope),
    },
    {
      name: 'propose_c4',
      available,
      description:
        'Propose ONE consistent package of the complete shared C4 model and related architecture, specifications and ADRs. Read get_c4_context for the schema and current revision. Documents are full Markdown files relative to .skaro/; ADR/spec files need frontmatter with string id, title and status. For a new specification choose the next unused four-digit number returned in context. The service computes body hashes and generates uniform interactive diagram previews. Do not author Mermaid, styles, coordinates or generated C4 sections. Model revision must equal base_revision + 1. Include evidence for all elements and relationships and map every specification requirement R-n. Planned work stays planned until published. The package is saved immediately but changes apply only after one owner decision. In an import this stages its C4 model; stage documents with stage_artifact and finish_import. Never discard source architecture or invent missing decisions.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          base_revision: { type: 'integer', minimum: 0 },
          model: {
            type: 'object',
            description: 'Complete model matching the schema from get_c4_context.',
          },
          documents: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, content: { type: 'string' } },
              required: ['path', 'content'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'summary', 'base_revision', 'model', 'documents'],
        additionalProperties: false,
      },
      call: call(
        (args): ProposeC4Args => {
          if (!Array.isArray(args.documents)) throw new Error('documents must be an array');
          const documents = args.documents.map((raw: Record<string, unknown>) => ({
            path: text(raw, 'path'),
            content: text(raw, 'content'),
          }));
          return {
            title: text(args, 'title'),
            summary: text(args, 'summary'),
            baseRevision: integer(args, 'base_revision'),
            model: args.model,
            documents,
          };
        },
        (args, scope) => handlers.propose(args, scope),
      ),
    },
    {
      name: 'review_c4',
      available: (scope) => scope.kind === 'task',
      description:
        'Before submitting implementation, inspect actual changed code against the task requirements and accepted C4. get_c4_context returns task.reviewScope derived from Git and task requirement IDs. Cover that scope, not the entire specification or unrelated parents. Report revision, changeHash, affected IDs, evidence and aligned. Only applicable open questions and stale affected documents block acceptance. Design/document-only Git changes do not require implementation review and cannot realize planned architecture. Required architecture changes still need an accepted propose_c4 package. A review does not itself publish planned architecture.',
      inputSchema: {
        type: 'object',
        properties: {
          revision: { type: 'integer', minimum: 1 },
          change_hash: { type: 'string' },
          elements: { type: 'array', items: { type: 'string' } },
          relationships: { type: 'array', items: { type: 'string' } },
          realized: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Planned element/relationship IDs whose complete implementation this task verified. Only these become current when its code is actually published. Empty for work that realizes none.',
          },
          evidence: { type: 'string' },
          aligned: { type: 'boolean' },
        },
        required: [
          'revision',
          'change_hash',
          'elements',
          'relationships',
          'realized',
          'evidence',
          'aligned',
        ],
        additionalProperties: false,
      },
      call: call(
        (args): ReviewC4Args => {
          if (typeof args.aligned !== 'boolean') throw new Error('aligned must be boolean');
          return {
            revision: integer(args, 'revision'),
            changeHash: text(args, 'change_hash'),
            elements: refs(args, 'elements'),
            relationships: refs(args, 'relationships'),
            realized: refs(args, 'realized'),
            evidence: text(args, 'evidence'),
            aligned: args.aligned,
          };
        },
        (args, scope) => handlers.review(args, scope),
      ),
    },
  ];
}
