// Helpers shared by task runs and chats: raw logs, projectors, secrets in answers.

import { readFile } from 'node:fs/promises';
import { ClaudeProjector } from '@skaro/adapter-claude';
import { CodexProjector } from '@skaro/adapter-codex';
import type {
  Emit,
  Interaction,
  InteractionAnswer,
  ProjectionContext,
  Projector,
  RawLine,
} from '@skaro/timeline';

export function projectorFor(agent: string): (ctx: ProjectionContext, emit: Emit) => Projector {
  return agent === 'codex'
    ? (ctx, emit) => new CodexProjector(ctx, emit)
    : (ctx, emit) => new ClaudeProjector(ctx, emit);
}

export async function readRunLog(path: string): Promise<RawLine[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const lines: RawLine[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line) as RawLine);
    } catch {
      // A line cut by a crash: the rest of the log still counts.
    }
  }
  return lines;
}

/** Secret answers (keys, passwords) never reach the log. */
export function withoutSecrets(
  interaction: Interaction,
  answer: InteractionAnswer,
): InteractionAnswer {
  if (interaction.kind !== 'question' || answer.kind !== 'question') return answer;
  const secret = new Set(interaction.questions.filter((q) => q.secret).map((q) => q.id));
  if (!secret.size) return answer;
  return {
    kind: 'question',
    answers: Object.fromEntries(
      Object.entries(answer.answers).map(([id, values]) => [id, secret.has(id) ? ['•••'] : values]),
    ),
  };
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
