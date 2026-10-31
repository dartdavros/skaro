import assert from 'node:assert/strict';
import {
  continueContextChatRequest,
  contextChatRequest,
  executeChatTurn,
  type ChatRequest,
  type ChatResponse,
  type OpenRouterConnector,
  type RuntimeSession,
} from '@skaro/agent-runtime';
import { admitLiveRequest } from './live-budget';

export const LONG_TOPICS = [
  'explicit edit authorization and the difference between a question and an instruction',
  'the current design baseline and the prohibition on restoring old HTML designs',
  'preserving exact UI structure, hierarchy, text, icons, states and behavior',
  'design gates when an approved screen or state is absent',
  'real local environments and why mock APIs, fixtures and seed data cannot substitute for them',
  'how documented Docker services relate to missing local tools',
  'truthful reporting of runtime verification and incomplete environments',
  'DRY, KISS, SRP and separation of concerns in this repository',
  'the component size threshold and composition-only pages',
  'the source-file size threshold and extracting independent modules',
  'reusing existing components instead of duplicating complex UI',
  'stable geometry for loading, error and ready states',
  'the common spinner and the prohibition on inventing UI behavior',
  'documentation-only changes and their verification rules',
  'small local UI changes and when builds are explicitly authorized',
  'code changes, builds and tests of directly affected scenarios',
  'why a complete test suite is reserved for release or explicit owner instruction',
  'browser verification and the meaning of checking the real application layout',
  'commit authorization and the repository commit convention',
  'release requirements for six exact installer links in a platform/architecture table',
  'preserving existing project patterns without temporary implementation shortcuts',
  'how source inspection, real execution and evidence support distinct claims',
  'which checks and decisions remain necessary before calling implementation complete',
  'a consistent checklist for continuing this actual project under both applicable AGENTS files',
];

export function auditPrompt(turn: number): string {
  return (
    `Continue the real policy audit of the two applicable AGENTS.md files already in this conversation. Audit note ${turn + 1}: analyze ${LONG_TOPICS[turn % LONG_TOPICS.length]}. ` +
    'Use only the supplied rules and previous actual audit notes; identify gaps without inventing project facts or claiming code, builds or tests were executed. ' +
    'First line: Working note: followed by one original concise English sentence, at most 180 characters, recording this note’s main finding. ' +
    'Then provide about 650–750 English words of concrete, non-repetitive guidance, relevant exact-rule references, implications for subsequent work and outstanding limitations. ' +
    'Do not pad, repeat earlier notes verbatim, call tools, access files or use direct provider APIs. The first line is a working note, not a new owner decision.'
  );
}
export function workingSentence(response: ChatResponse): string {
  const match = /^Working note:\s*([^\r\n]+)/im.exec(response.message.content ?? '');
  assert(
    match && match[1]!.trim().length >= 20 && match[1]!.trim().length <= 220,
    'Missing genuine bounded working note',
  );
  return match[1]!.trim();
}
export function requireRecovered(response: ChatResponse, expected: string): void {
  const normalize = (text: string) =>
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
  assert(
    normalize(response.message.content ?? '').includes(normalize(expected)),
    'Pre-compact working note was not recovered verbatim',
  );
  assert.match(response.message.content ?? '', /позже|отлож|(?:не|без).*(?:провер|запуск)/i);
}
export const RECOVERY_PROMPT =
  'Use context-data.workingNoteHead to select the working note with the exact same source sequence/hash/id. Recover its Working note sentence verbatim. Do not select by array position or turn-name suffix. Output Recovered note: followed by that sentence, then Decision: and the owner’s actual decision in Russian about direct OpenAI/Anthropic/DeepSeek live checks. Do not invent a new note or perform any action.';

export async function longTurn(input: {
  session: RuntimeSession;
  connector: OpenRouterConnector;
  id: string;
  prompt: string;
  signal: AbortSignal;
  fresh?: boolean;
}): Promise<{ response: ChatResponse; request?: ChatRequest }> {
  const existing = input.session.journal.find(`model-${input.id}-0:result`);
  const saved = input.session.journal.find(`long:request:${input.id}`)?.result.value as
    ChatRequest | undefined;
  if (existing) return { response: existing.result.value as ChatResponse, request: saved };
  const prepare = input.fresh ? contextChatRequest : continueContextChatRequest;
  const request =
    saved ??
    prepare(input.session, {
      route: input.session.journal.state.config!.route,
      price: { prompt: 0.15, completion: 0.6, request: 0 },
      messages: [{ role: 'user', content: input.prompt }],
    });
  if (input.fresh)
    assert(
      request.messages.every((message) => message.role !== 'assistant' && message.role !== 'tool'),
      'Closed native messages crossed compact',
    );
  if (input.fresh && !saved)
    await input.session.journal.append(`long:request:${input.id}`, [], { value: request });
  const response = await executeChatTurn({
    id: input.id,
    session: input.session,
    connector: input.connector,
    request,
    signal: input.signal,
    maxSteps: 1,
    admitRequest: (id, current) => admitLiveRequest(input.session, current, id),
  });
  assert.equal(response.finishReason, 'stop');
  assert(
    response.provenance.usage.inputTokens !== null &&
      response.provenance.usage.outputTokens !== null &&
      response.provenance.usage.cost?.currency === 'USD',
  );
  return { response, request };
}
