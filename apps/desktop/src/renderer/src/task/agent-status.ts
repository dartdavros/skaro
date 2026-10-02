import { t } from '@skaro/ui';
import type { AgentInfo } from '../../../shared/ipc';
export function agentState(a: AgentInfo): { text: string; color: string; link?: 'login' } {
  if (a.download) {
    const mb = (n: number) => Math.round(n / 1e6);
    return {
      text: t('agent.state.downloading', {
        a: mb(a.download.received),
        b: mb(a.download.total ?? a.sizeBytes),
      }),
      color: 'var(--sk-text-20)',
    };
  }
  if (a.checking) return { text: t('agent.state.checking'), color: 'var(--sk-text-22)' };
  if (!a.installed)
    return {
      text: t('agent.state.download', { mb: Math.round(a.sizeBytes / 1e6) }),
      color: 'var(--sk-text-22)',
    };
  if (a.authenticated === false)
    return { text: t('agent.state.signin'), color: 'var(--sk-warn)', link: 'login' };
  if (a.error) return { text: t('agent.state.error'), color: 'var(--sk-text-22)' };
  return { text: t('agent.state.ready'), color: 'var(--sk-text-22)' };
}
