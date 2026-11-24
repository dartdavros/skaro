import type { C4DocumentChange } from '@skaro/core';
import { ToolArgsError, text } from './project-tool-args.ts';

export const C4_DOCUMENTS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string', description: 'Full Markdown for a new file.' },
      base_hash: { type: 'string', description: 'Exact file hash from documentHashes.' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            old_text: { type: 'string', description: 'An exact, unique fragment of the file.' },
            new_text: {
              type: 'string',
              description: 'Replacement text. Empty deletes the fragment.',
            },
          },
          required: ['old_text', 'new_text'],
          additionalProperties: false,
        },
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ToolArgsError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function readC4DocumentChanges(value: unknown): C4DocumentChange[] {
  if (!Array.isArray(value)) throw new ToolArgsError('documents must be an array');
  return value.map((entry: unknown) => {
    const doc = object(entry, 'document');
    const path = text(doc, 'path');
    if (doc.edits === undefined && doc.base_hash === undefined)
      return { path, content: text(doc, 'content') };
    if (doc.content !== undefined || !Array.isArray(doc.edits) || !doc.edits.length)
      throw new ToolArgsError(
        'Use either content for a new file or base_hash and edits for an existing file',
      );
    const edits = doc.edits.map((entry: unknown) => {
      const edit = object(entry, 'edit');
      if (
        typeof edit.old_text !== 'string' ||
        !edit.old_text.trim() ||
        typeof edit.new_text !== 'string'
      )
        throw new ToolArgsError('Each edit requires non-blank old_text and string new_text');
      return { oldText: edit.old_text, newText: edit.new_text };
    });
    return { path, baseHash: text(doc, 'base_hash'), edits };
  });
}
