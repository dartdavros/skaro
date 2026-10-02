import { t, tn } from '@skaro/ui';
import type { AgentUserConfig } from '@skaro/timeline';
import type { AgentInfo } from '../../../shared/ipc';

export function shortDir(dir: string): string {
  const path = dir.replace(/\\/g, '/');
  return path.replace(/^(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
}

export function mcpView(server: AgentUserConfig['mcp'][number]): {
  dot: string;
  meta: string;
  color: string;
  tip: string;
} {
  switch (server.state) {
    case 'ok':
      return {
        dot: 'var(--sk-fill-41)',
        meta: tn('settings.mcp.tools', server.tools),
        color: 'var(--sk-text-22)',
        tip: t('settings.mcp.ok.tip'),
      };
    case 'needs_auth':
      return {
        dot: 'var(--sk-warn)',
        meta: t('settings.mcp.auth'),
        color: 'var(--sk-warn)',
        tip: t('settings.mcp.auth.tip'),
      };
    case 'disabled':
      return {
        dot: 'var(--sk-fill-36)',
        meta: t('settings.mcp.disabled'),
        color: 'var(--sk-text-22)',
        tip: t('settings.mcp.disabled'),
      };
    default:
      return {
        dot: 'var(--sk-error)',
        meta: t('settings.mcp.failed'),
        color: 'var(--sk-error)',
        tip: server.error ?? t('settings.mcp.failed.tip'),
      };
  }
}

export function effortLabel(id: string): string {
  const key = `effort.${id}`;
  const text = t(key);
  return text === key ? id : text;
}

export function stateOf(a: AgentInfo): { text: string; dot: string; pulse: boolean; tip: string } {
  const mb = (n: number) => Math.round(n / 1e6);
  if (a.download) {
    return {
      text: t('settings.agent.loading', {
        a: mb(a.download.received),
        b: mb(a.download.total ?? a.sizeBytes),
      }),
      dot: 'var(--sk-fill-41)',
      pulse: true,
      tip: t('settings.agent.loading.tip'),
    };
  }
  if (a.checking)
    return { text: t('agent.state.checking'), dot: 'var(--sk-fill-36)', pulse: true, tip: '' };
  if (!a.installed)
    return {
      text: t('settings.agent.notLoaded', { mb: mb(a.sizeBytes) }),
      dot: 'var(--sk-fill-36)',
      pulse: false,
      tip: t('settings.agent.notLoaded.tip'),
    };
  if (a.authenticated === false)
    return {
      text: t('agent.state.signin'),
      dot: 'var(--sk-warn)',
      pulse: false,
      tip: t('agent.state.signin'),
    };
  return {
    text: t('settings.agent.ready'),
    dot: 'var(--sk-fill-41)',
    pulse: false,
    tip: t('agent.state.ready'),
  };
}
