import { t } from '@skaro/ui';
import type { ProjectCard } from '../../../shared/ipc';
import { agentName, prettyModel } from '../feed/format';
export function shortPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
}

export function ago(at: number, now: number): string {
  const m = Math.floor((now - at) / 60_000);
  if (m < 1) return t('ago.now');
  if (m < 60) return t('ago.min', { n: m });
  if (m < 1440) return t('ago.hour', { n: Math.round(m / 60) });
  const d = Math.round(m / 1440);
  if (d === 1) return t('ago.yesterday');
  if (d < 30) return t('ago.day', { n: d });
  return t('ago.month', { n: Math.round(d / 30) });
}

export function marks(
  c: ProjectCard,
): { count: number; color: string; pulse: boolean; tip: string }[] {
  return [
    { count: c.counts.working, color: 'var(--sk-text-15)', pulse: true, key: 'working' },
    { count: c.counts.needs, color: 'var(--sk-accent)', pulse: false, key: 'needs' },
    { count: c.counts.review, color: 'var(--sk-accent)', pulse: false, key: 'review' },
    { count: c.counts.failed, color: 'var(--sk-error)', pulse: false, key: 'failed' },
  ]
    .filter((m) => m.count > 0)
    .map((m) => ({ ...m, tip: t(`projects.mark.${m.key}`, { n: m.count }) }));
}

export function agentLine(agent: string, model?: string): string {
  return model ? `${agentName(agent)} · ${prettyModel(model)}` : agentName(agent);
}
