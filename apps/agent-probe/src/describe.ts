import type { Item, TimelineEvent } from '@skaro/timeline';

/** One console line per canonical event; deltas and activity are skipped to keep output readable. */
export function describe(event: TimelineEvent): string | undefined {
  switch (event.t) {
    case 'session.started':
      return `● session ${event.nativeSessionId} model=${event.model} v${event.capabilities.agentVersion ?? '?'}`;
    case 'turn.started':
      return `┌ turn ${event.turnId}`;
    case 'turn.completed':
      return `└ turn ${event.outcome}${event.error ? ` [${event.error.category}] ${oneLine(event.error.message)}` : ''}`;
    case 'item.upsert':
      return `│ ${item(event.item)}`;
    case 'plan.updated':
      return `│ ☰ plan ${event.steps.map((s) => `${s.status === 'done' ? '✓' : s.status === 'active' ? '▸' : '○'} ${s.text}`).join(' · ')}`;
    case 'interaction.opened': {
      const i = event.interaction;
      const what =
        i.kind === 'approval'
          ? `${i.action.type}: ${oneLine(i.action.command ?? i.action.paths?.join(', ') ?? i.action.title)}`
          : i.kind === 'question'
            ? i.questions
                .map((q) => `${q.header}: ${q.text} [${q.options.map((o) => o.label).join('|')}]`)
                .join(' / ')
            : i.kind === 'plan_approval'
              ? oneLine(i.plan)
              : i.kind;
      return `│ ? ${i.kind} ${what}`;
    }
    case 'interaction.closed':
      return `│ ! ${event.resolution}`;
    case 'usage':
      return `│ Σ in=${event.inputTokens} out=${event.outputTokens}${event.contextUsedPct !== undefined ? ` ctx=${event.contextUsedPct}%` : ''}`;
    case 'limits':
      return event.state === 'ok'
        ? undefined
        : `│ ⏳ limits ${event.state} ${event.resetsAt ?? ''}`;
    case 'status':
      return `│ · ${event.state}`;
    case 'rewound':
      return `│ ↶ rewound to ${event.toItemId}`;
    default:
      return undefined;
  }
}

function item(i: Item): string {
  const head = `${i.parentId ? '↳ ' : ''}${i.status.padEnd(9)}`;
  switch (i.kind) {
    case 'message':
      return `${head} ${i.role === 'user' ? '👤' : '🤖'} ${i.phase ?? ''} ${oneLine(i.text)}`;
    case 'reasoning':
      return `${head} 💭 ${i.redacted ? '(redacted)' : oneLine(i.text ?? '')}`;
    case 'explore':
      return `${head} 🔍 ${i.op} ${i.target}${i.detail ? ` ${i.detail}` : ''}${i.image ? ` [image ${i.image.mime}]` : ''}`;
    case 'file_change':
      return `${head} ✎ ${i.files.map((f) => `${f.change} ${f.path} +${f.added ?? '?'} −${f.removed ?? '?'}`).join(', ')}`;
    case 'command':
      return `${head} $ ${oneLine(i.command)}${i.description ? ` — ${i.description}` : ''}${i.exitCode !== undefined ? ` [exit ${i.exitCode}]` : ''}${i.background ? ` [bg ${i.background.state}]` : ''}${i.output ? ` → ${oneLine(i.output)}` : ''}`;
    case 'task':
      return `${head} ⑂ ${i.title}${i.agentType ? ` (${i.agentType})` : ''}${i.actions ? ` · ${i.actions} actions` : ''}${i.summary ? ` → ${oneLine(i.summary)}` : ''}`;
    case 'image':
      return `${head} 🖼 ${i.source} ${i.image.path ?? i.image.id}`;
    case 'tool':
      return `${head} ⚙ ${i.server ? `${i.server}/` : ''}${i.name}${i.output ? ` → ${oneLine(i.output)}` : ''}`;
    case 'notice':
      return `${head} ⚑ ${i.level} ${i.code} ${oneLine(i.text)}${i.retry ? ` (${i.retry.attempt}/${i.retry.max} in ${i.retry.inMs}ms)` : ''}`;
    case 'unknown':
      return `${head} ⁇ unknown ${i.native.type}`;
  }
}

function oneLine(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
