import { diffPreview, type FeedRow } from '@skaro/timeline';
import { t, tn } from '@skaro/ui';
import type { ProposalAction } from '../../../shared/ipc';
import { useFeed } from './context.svelte';
import { proposalSummary } from './proposal-summary';
import { togglePlanTask } from './plan-selection';
import { SvelteSet } from 'svelte/reactivity';
import { replanCanDecide, type ReplanOperation } from './proposal-replan';
export class ProposalState {
  private readonly getRow: () => Extract<FeedRow, { type: 'proposal' }>;
  constructor(getRow: () => Extract<FeedRow, { type: 'proposal' }>) {
    this.getRow = getRow;
    const draft = this.feed.rowDrafts?.get(getRow().id);
    if (draft) {
      this.selection = draft.selection;
      this.adrTitle = draft.title;
      this.adrBody = draft.body;
    }
  }
  remember(): void {
    this.feed.rowDrafts?.set(this.row.id, {
      selection: this.selection,
      title: this.adrTitle,
      body: this.adrBody,
    });
  }
  get row() {
    return this.getRow();
  }
  feed = useFeed();
  item = $derived(this.row.item);
  proposal = $derived(this.item.proposal);
  actionable = $derived(this.feed.interactive && this.feed.proposal !== undefined);
  busy = $state(false);
  replanRequest = $state<ReplanOperation | undefined>();
  viewer = $state(false);
  editing = $state(false);
  adrTitle = $state('');
  adrBody = $state('');
  diff = $derived.by(() => {
    if (
      this.proposal.type !== 'doc' &&
      this.proposal.type !== 'task' &&
      this.proposal.type !== 'task_replan' &&
      this.proposal.type !== 'spec_change'
    )
      return undefined;
    return diffPreview(this.proposal.before ?? '', this.proposal.after);
  });
  plan = $derived(this.proposal.type === 'plan' ? this.proposal : undefined);
  accepted = $derived(this.item.state === 'accepted');
  selection = $state<string[] | undefined>();
  created = $derived(new SvelteSet(this.item.result?.tasks?.map((t) => t.ref)));
  progressText = $derived(this.item.result?.error ?? t('proposal.plan.creating'));
  milestoneOnly = $derived(this.plan?.milestone?.isNew === true && this.plan.tasks.length === 0);
  chosen = $derived(
    this.plan
      ? this.plan.tasks.filter((t) => this.selected(t.ref) && !this.created.has(t.ref))
      : [],
  );
  summaryLine = $derived(proposalSummary(this.item));
  async decide(action: ProposalAction): Promise<void> {
    if (!this.feed.proposal || this.busy || !replanCanDecide(this.item, action)) return;
    this.busy = true;
    if (
      this.proposal.type === 'task_replan' &&
      (action.action === 'apply' || action.action === 'revert')
    )
      this.replanRequest = action.action;
    try {
      await this.feed.proposal(this.item.id, action);
    } catch {
      // The screen shows the error in its banner.
    } finally {
      this.busy = false;
      this.replanRequest = undefined;
    }
  }
  toggle(ref: string): void {
    if (this.item.state !== 'pending' || !this.actionable) return;
    if (!this.plan) return;
    this.selection = [
      ...togglePlanTask(
        this.plan.tasks,
        new SvelteSet(this.plan.tasks.filter((t) => this.selected(t.ref)).map((t) => t.ref)),
        ref,
        this.created,
      ),
    ];
  }
  startEdit(): void {
    if (this.proposal.type !== 'adr' && this.proposal.type !== 'spec') return;
    this.adrTitle = this.proposal.title;
    this.adrBody = this.proposal.body;
    this.editing = true;
  }
  planTitle(): string {
    if (!this.plan) return '';
    if (this.plan.complete)
      return t('proposal.plan.complete', {
        title: this.plan.title ?? t('proposal.plan.defaultTitle'),
        tasks: tn('proposal.tasks', this.plan.tasks.length),
      });
    if (this.milestoneOnly)
      return t('proposal.plan.milestone', {
        id: this.plan.milestone!.id,
        title: this.plan.milestone!.title,
      });
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
  selected(ref: string): boolean {
    if (this.created.has(ref)) return true;
    return this.accepted
      ? !!this.item.result?.selected?.includes(ref)
      : this.selection
        ? this.selection.includes(ref)
        : !this.item.result?.omitted?.includes(ref);
  }
  meta(task: { ref: string; dependsOnTitles: string[]; milestone?: { id: string } }): string {
    const created = this.item.result?.tasks?.find((t) => t.ref === task.ref);
    if (created) return t('proposal.plan.created', { id: created.id });
    if (!this.selected(task.ref)) return t('proposal.plan.declined');
    const deps = task.dependsOnTitles.length
      ? t('proposal.plan.meta.after', {
          list: task.dependsOnTitles.map((d) => `«${d}»`).join(', '),
        })
      : t('proposal.plan.meta.none');
    const milestone = task.milestone ?? this.plan?.milestone;
    return milestone && !task.milestone ? `${milestone.id} · ${deps}` : deps;
  }
}
