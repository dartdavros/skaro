import { untrack } from 'svelte';
import type { AgentLimits } from '@skaro/timeline';
import type { AgentInfo } from '../../../shared/ipc';

/** The provider account belongs to the managed agent and is shared by all open views. */
class AccountLimits {
  snapshot = $state.raw<AgentLimits>();
  private pending?: Promise<AgentLimits>;
  private timer?: ReturnType<typeof setInterval>;
  private watchers = 0;
  private readonly update = () => void this.refresh().catch(() => {});

  private readonly agent: AgentInfo['id'];
  constructor(agent: AgentInfo['id']) {
    this.agent = agent;
  }

  refresh(): Promise<AgentLimits> {
    return (this.pending ??= window.skaro
      .invoke('agents.limits', this.agent)
      .then(
        (snapshot) => {
          if (this.watchers) this.snapshot = snapshot;
          return snapshot;
        },
        (error: unknown) => {
          this.snapshot = undefined;
          throw error;
        },
      )
      .finally(() => {
        this.pending = undefined;
      }));
  }

  watch(): () => void {
    if (++this.watchers === 1) {
      this.timer = setInterval(this.update, 180_000);
      window.addEventListener('focus', this.update);
    }
    this.update();
    return () => {
      if (--this.watchers === 0) {
        clearInterval(this.timer);
        window.removeEventListener('focus', this.update);
        this.snapshot = undefined;
      }
    };
  }
}

const accounts: Partial<Record<AgentInfo['id'], { identity: string; limits: AccountLimits }>> = {};
export function accountLimits(agent?: AgentInfo) {
  if (!agent || agent.id === 'skaro') return undefined;
  if (!agent.installed || agent.authenticated === false) {
    delete accounts[agent.id];
    return undefined;
  }
  const identity = JSON.stringify([
    agent.account,
    agent.configurationRevision,
    agent.authenticated,
  ]);
  let entry = accounts[agent.id];
  if (entry?.identity !== identity) {
    entry = { identity, limits: new AccountLimits(agent.id) };
    accounts[agent.id] = entry;
  }
  return entry.limits;
}

export function watchAccount(read: () => AgentInfo | undefined) {
  const account = $derived(accountLimits(read()));
  $effect(() => account?.watch());
  return {
    get snapshot() {
      return account?.snapshot;
    },
    refresh() {
      untrack(() => void account?.refresh().catch(() => {}));
    },
  };
}
