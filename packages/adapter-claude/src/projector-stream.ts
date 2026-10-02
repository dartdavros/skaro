import { num, obj, str, type Obj } from '@skaro/timeline';
import { AGENT } from './projector-helpers.ts';
import type { ClaudeProjectionState } from './projector-state.ts';

export class ClaudeStreamProjection {
  private readonly state: ClaudeProjectionState;
  constructor(state: ClaudeProjectionState) {
    this.state = state;
  }
  onStreamEvent(msg: Obj): void {
    const event = obj(msg['event']);
    if (!event) return;
    const parentId = str(msg['parent_tool_use_id']);
    switch (str(event['type'])) {
      case 'message_start':
        this.state.streamMessageId = str(obj(event['message'])?.['id']) ?? '';
        this.state.streamBlocks.clear();
        return;
      case 'content_block_start': {
        const index = num(event['index']) ?? 0;
        const block = obj(event['content_block']);
        const blockType = str(block?.['type']) ?? '';
        const id = this.state.blockId(this.state.streamMessageId, blockType, block);
        this.state.streamBlocks.set(index, { id, type: blockType });
        if (blockType === 'thinking' || blockType === 'redacted_thinking') {
          this.state.emit({ t: 'activity', state: 'thinking' });
          this.state.upsert({
            id,
            parentId,
            kind: 'reasoning',
            text: '',
            redacted: blockType === 'redacted_thinking',
            status: 'running',
            native: { agent: AGENT, type: 'stream.thinking', ref: id },
          });
        } else if (blockType === 'text') {
          this.state.emit({ t: 'activity', state: 'writing' });
          this.state.upsert({
            id,
            parentId,
            kind: 'message',
            role: 'agent',
            text: '',
            phase: 'commentary',
            status: 'running',
            native: { agent: AGENT, type: 'stream.text', ref: id },
          });
        } else if (blockType === 'tool_use') {
          const name = str(block?.['name']) ?? '';
          const editing = ['Edit', 'Write', 'NotebookEdit'].includes(name);
          this.state.emit({ t: 'activity', state: editing ? 'preparing_edit' : 'waiting_model' });
        }
        return;
      }
      case 'content_block_delta': {
        const block = this.state.streamBlocks.get(num(event['index']) ?? -1);
        const delta = obj(event['delta']);
        if (!block || !delta) return;
        const deltaType = str(delta['type']);
        if (deltaType === 'text_delta') {
          this.state.emit({
            t: 'item.append',
            itemId: block.id,
            field: 'text',
            chunk: str(delta['text']) ?? '',
          });
        } else if (deltaType === 'thinking_delta') {
          this.state.emit({
            t: 'item.append',
            itemId: block.id,
            field: 'text',
            chunk: str(delta['thinking']) ?? '',
          });
        } else if (deltaType === 'input_json_delta' && block.type === 'tool_use') {
          // Live line: the edited path appears in the partial input before the call completes.
          const match = /"(?:file_path|notebook_path)"\s*:\s*"([^"]+)"/.exec(
            str(delta['partial_json']) ?? '',
          );
          if (match?.[1])
            this.state.emit({ t: 'activity', state: 'preparing_edit', target: match[1] });
        }
        return;
      }
      default:
        return;
    }
  }
}
