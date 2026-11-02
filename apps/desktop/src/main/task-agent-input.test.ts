import { describe, expect, it } from 'vitest';
import { withoutSkaroNote } from '@skaro/timeline';
import { taskAgentInput } from './task-agent-input';

describe('task delivery adapter input boundary', () => {
  it('keeps owner text and the command note without copying private inbox or scheduler fields', () => {
    const input = {
      text: 'owner message',
      commandId: 'durable-command',
      internal: true,
      privateText: 'encrypted-inbox-reference',
    };
    const delivered = taskAgentInput(input);
    expect(Object.keys(delivered)).toEqual(['text']);
    expect(withoutSkaroNote(delivered.text)).toBe(input.text);
    expect(delivered.text).toContain('command_id: durable-command\norchestration: task');
    expect(delivered.text).not.toContain(input.privateText);
    expect(input.privateText).toBe('encrypted-inbox-reference');
  });
  it('preserves real attachment references without sharing mutable input arrays or empty fields', () => {
    const input = { text: 'owner message', images: ['C:/owner/attachment.png'] };
    const delivered = taskAgentInput(input);
    expect(delivered).toEqual(input);
    expect(delivered.images).not.toBe(input.images);
    expect(taskAgentInput({ ...input, images: [] })).toEqual({ text: input.text });
  });
});
