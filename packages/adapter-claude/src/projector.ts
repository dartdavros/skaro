// Claude Code raw stream → canonical timeline; focused services share projection state.
import type { ProjectionContext, Emit } from '@skaro/timeline';
import { ClaudeProjectionState } from './projector-state.ts';
export const CLAUDE_ADAPTER_VERSION = '0.1.0';
export class ClaudeProjector {
  private readonly state: ClaudeProjectionState;
  constructor(ctx: ProjectionContext, emit: Emit) {
    this.state = new ClaudeProjectionState(ctx, emit);
  }
  input(line: unknown): void {
    this.state.transport.input(line);
  }
  output(line: unknown): void {
    this.state.transport.output(line);
  }
  interactionForToolUse(toolUseId: string): string | undefined {
    return this.state.interactionForToolUse(toolUseId);
  }
}
