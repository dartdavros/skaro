// Codex app-server raw stream → canonical timeline; focused services share projection state.
import type { ProjectionContext, Emit } from '@skaro/timeline';
import { CodexProjectionState } from './projector-state.ts';
export { displayCommand } from './projector-helpers.ts';
export const CODEX_ADAPTER_VERSION = '0.1.0';
export class CodexProjector {
  private readonly state: CodexProjectionState;
  constructor(ctx: ProjectionContext, emit: Emit) {
    this.state = new CodexProjectionState(ctx, emit);
  }
  input(line: unknown): void {
    this.state.transport.input(line);
  }
  output(line: unknown): void {
    this.state.transport.output(line);
  }
  turnOf(itemId: string): string | undefined {
    return this.state.turnOf(itemId);
  }
}
