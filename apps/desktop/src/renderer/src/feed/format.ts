// Small formatting helpers for the feed.

import type { AgentModel } from '@skaro/timeline';
import { t } from '@skaro/ui';

/** 0:05, 4:36, 1:02:03 */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "12 с" under a minute, otherwise a clock. */
export function duration(ms: number): string {
  return ms < 60_000 ? t('time.s', { n: Math.max(1, Math.round(ms / 1000)) }) : clock(ms);
}

/** Short command duration: "4с" / "1:12". */
export function shortDuration(ms: number): string {
  return ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}с` : clock(ms);
}

export function tokens(n: number): string {
  return n >= 1000 ? t('tokens.k', { n: Math.round(n / 1000) }) : t('tokens.n', { n });
}

/** A path as the user knows it: relative to the working folder, forward slashes. */
export function displayPath(path: string, cwd?: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (cwd) {
    const root = cwd.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      return normalized.slice(root.length + 1);
    }
  }
  return normalized.replace(/^<workspace>\//, '');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function agentName(agent: string): string {
  return agent === 'codex' ? 'Codex' : 'Claude Code';
}

/** Model id as people say it: claude-opus-5-1 → Opus 5.1. */
export function prettyModel(id: string): string {
  const claude = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/.exec(id);
  if (claude) {
    const name = claude[1]![0]!.toUpperCase() + claude[1]!.slice(1);
    return `${name} ${claude[2]}${claude[3] && claude[3].length <= 2 ? `.${claude[3]}` : ''}`;
  }
  if (id === 'default') return 'Claude Code';
  return id;
}

/** The model's own name ("Opus 5.5") — from the agent's list, else from the id; never "default". */
export function modelName(id: string | undefined, models: AgentModel[]): string {
  const known =
    models.find((m) => m.id === id) ??
    (!id || id === 'default' ? models.find((m) => m.isDefault) : undefined);
  if (known) return known.name;
  return id && id !== 'default' ? prettyModel(id) : '';
}

/** URL of an image for <img>: stored attachment or a file Skaro may show. */
export function imageUrl(ref: { id: string; mime: string; path?: string }): string {
  if (/^[a-f0-9]{64}$/.test(ref.id)) {
    const ext = ref.mime === 'image/jpeg' ? 'jpg' : (ref.mime.split('/')[1] ?? 'png');
    return `skaro-media://attachment/${ref.id}.${ext}`;
  }
  return localImageUrl(ref.path ?? ref.id);
}

export function localImageUrl(path: string): string {
  return `skaro-media://file/?path=${encodeURIComponent(path)}`;
}
