import { diffExcerpt, diffStats, lineDiff, type FeedRow } from '@skaro/timeline';
import { t, tn } from '@skaro/ui';
import type { ProposalAction } from '../../../shared/ipc';
import { useFeed } from './context.svelte';
import { proposalSummary } from './proposal-summary';
const MAX_LINES = 12;
export class ProposalState {
  private readonly getRow: () => Extract<FeedRow, { type: 'proposal' }>;
  constructor(getRow: () => Extract<FeedRow, { type: 'proposal' }>) {
    this.getRow = getRow;
  }
  get row() {
    return this.getRow();
  }
  feed = useFeed();
  item = $derived(this.row.item);
  proposal = $derived(this.item.proposal);
  actionable = $derived(this.feed.interactive && this.feed.proposal !== undefined);
  busy = $state(false);
  viewer = $state(false);
  editing = $state(false);
  adrTitle = $state('');
  adrBody = $state('');
  skipped = $state<string[]>([]);
  diff = $derived.by(() => {
    if (
      this.proposal.type !== 'doc' &&
      this.proposal.type !== 'task' &&
      this.proposal.type !== 'spec_change'
    )
      return undefined;
    const lines = lineDiff(this.proposal.before ?? '', this.proposal.after);
    // Blank lines carry nothing on a card; the viewer shows the whole text.
    const excerpt = diffExcerpt(lines, 1)
      .map((l) =>
        'op' in l ? { gap: false, op: l.op, text: l.text } : { gap: true, op: ' ', text: '' },
      )
      .filter((l) => l.gap || l.text.trim() !== '');
    return {
      stats: diffStats(lines),
      lines: excerpt.slice(0, MAX_LINES),
      more: excerpt.length > MAX_LINES,
    };
  });
  plan = $derived(this.proposal.type === 'plan' ? this.proposal : undefined);
  chosen = $derived(this.plan ? this.plan.tasks.filter((t) => !this.skipped.includes(t.ref)) : []);
  summaryLine = $derived(proposalSummary(this.item));
  async decide(action: ProposalAction): Promise<void> {
    if (!this.feed.proposal || this.busy) return;
    this.busy = true;
    try {
      await this.feed.proposal(this.item.id, action);
    } catch {
      // The screen shows the error in its banner.
    } finally {
      this.busy = false;
    }
  }
  toggle(ref: string): void {
    if (this.item.state !== 'pending' || !this.actionable) return;
    this.skipped = this.skipped.includes(ref)
      ? this.skipped.filter((r) => r !== ref)
      : [...this.skipped, ref];
  }
  startEdit(): void {
    if (this.proposal.type !== 'adr' && this.proposal.type !== 'spec') return;
    this.adrTitle = this.proposal.title;
    this.adrBody = this.proposal.body;
    this.editing = true;
  }
  planTitle(): string {
    if (!this.plan) return '';
    const tasks = tn('proposal.tasks', this.plan.tasks.length);
    if (this.plan.milestone?.isNew)
      return t('proposal.plan.new', {
        id: this.plan.milestone.id,
        title: this.plan.milestone.title,
        tasks,
      });
    if (this.plan.milestone)
      return t('proposal.plan.into', {
        id: this.plan.milestone.id,
        title: this.plan.milestone.title,
        tasks,
      });
    return tasks;
  }
  meta(task: { dependsOnTitles: string[] }): string {
    const deps = task.dependsOnTitles.length
      ? t('proposal.plan.meta.after', {
          list: task.dependsOnTitles.map((d) => `«${d}»`).join(', '),
        })
      : t('proposal.plan.meta.none');
    return this.plan?.milestone ? `${this.plan.milestone.id} · ${deps}` : deps;
  }
}
