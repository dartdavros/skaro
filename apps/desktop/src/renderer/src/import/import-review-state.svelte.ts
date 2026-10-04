import { diffExcerpt, diffStats, lineDiff } from '@skaro/timeline';
import { t } from '@skaro/ui';
import { SvelteMap } from 'svelte/reactivity';
import type { ImportReview, ImportReviewItem } from '../../../shared/ipc';
export interface ReviewOptions {
  projectId: string;
  chatId: string;
  onclose: () => void;
  /** Writes the picked artifacts; rejects with the reason. */
  onapply: (keys: string[]) => Promise<void>;
}
export class ImportReviewState {
  private readonly options: () => ReviewOptions;
  private readonly stop: () => void;
  constructor(options: () => ReviewOptions) {
    this.options = options;
    // svelte-ignore state_referenced_locally
    void window.skaro.invoke('import.review', this.projectId, this.chatId).then((r) => {
      this.review = r;
      this.selected = r.items.find((i) => i.type === 'architecture')?.key ?? r.items[0]?.key;
    });
    this.stop = window.skaro.on('import.progress', (p) => {
      if (p.chatId === this.chatId) this.progress = { done: p.done, total: p.total };
    });
  }
  get projectId() {
    return this.options().projectId;
  }
  get chatId() {
    return this.options().chatId;
  }
  get onclose() {
    return this.options().onclose;
  }
  get onapply() {
    return this.options().onapply;
  }
  review = $state<ImportReview | undefined>();
  off = $state<Record<string, boolean>>({});
  selected = $state<string | undefined>();
  skippedOpen = $state(false);
  notesOpen = $state(false);
  applying = $state(false);
  progress = $state({ done: 0, total: 0 });
  error = $state<string | undefined>();
  errorIsFile = $state(false);
  items = $derived(this.review?.items ?? []);
  byKey = $derived(new SvelteMap(this.items.map((i) => [i.key, i])));
  on = (key: string) => !this.off[key];
  picked = $derived(this.items.filter((i) => this.on(i.key)));
  current = $derived(this.items.find((i) => i.key === this.selected));
  core = $derived(this.items.filter((i) => i.type === 'brief' || i.type === 'architecture'));
  milestones = $derived(this.items.filter((i) => i.type === 'milestone'));
  tasks = $derived(this.items.filter((i) => i.type === 'task'));
  planItems = $derived([...this.milestones, ...this.tasks]);
  tasksOf = (key: string) => this.tasks.filter((x) => x.milestone === key);
  loose = $derived(
    this.tasks.filter((x) => !x.milestone || this.byKey.get(x.milestone)?.type !== 'milestone'),
  );
  diff = $derived.by(() => {
    if (!this.current?.update || this.current.before === undefined) return undefined;
    const lines = lineDiff(this.current.before, this.current.body);
    return {
      stats: diffStats(lines),
      lines: diffExcerpt(lines, 1)
        .map((l) => ('op' in l ? { op: l.op, text: l.text } : { op: ' ', text: '⋯' }))
        .filter((l) => l.text.trim() !== ''),
    };
  });
  set(keys: string[], value: boolean): void {
    const next = { ...this.off };
    for (const k of keys) {
      if (value) delete next[k];
      else next[k] = true;
    }
    this.off = next;
  }
  toggle(item: ImportReviewItem): void {
    const value = !this.on(item.key);
    const kids =
      item.type === 'milestone' && !value ? this.tasksOf(item.key).map((x) => x.key) : [];
    this.set([item.key, ...kids], value);
  }
  toggleGroup(list: ImportReviewItem[]): void {
    const all = list.every((i) => this.on(i.key));
    this.set(
      list.map((i) => i.key),
      !all,
    );
  }
  dangling(item: ImportReviewItem): boolean {
    return this.on(item.key) && item.refs.some((r) => !this.on(r));
  }
  code(item: ImportReviewItem): string {
    if (item.type === 'adr') return t('import.review.adrCode');
    if (item.type === 'spec') return t('import.review.specCode');
    if (item.type === 'milestone') return this.review?.milestones[item.key] ?? '';
    return '';
  }
  fields(item: ImportReviewItem): { label: string; text: string }[] {
    const f = item.fields ?? {};
    if (item.type === 'milestone') {
      return [
        { label: t('import.review.goal'), text: f.goal ?? '' },
        { label: t('import.review.doneWhen'), text: f.doneWhen ?? '' },
      ];
    }
    const deps = item.dependsOn
      .map((d) => this.byKey.get(d)?.title ?? d)
      .map((title) => `«${title}»`)
      .join(', ');
    return [
      { label: t('import.review.goal'), text: f.goal ?? '' },
      { label: t('import.review.criteria'), text: (f.criteria ?? []).join(' · ') },
      {
        label: t('import.review.deps'),
        text: deps ? t('import.review.after', { list: deps }) : t('import.review.none'),
      },
    ];
  }
  async apply(): Promise<void> {
    if (!this.picked.length || this.applying) return;
    this.applying = true;
    this.error = undefined;
    this.progress = { done: 0, total: this.picked.length };
    try {
      await this.onapply(this.picked.map((i) => i.key));
      this.onclose();
    } catch (e) {
      const text = (e instanceof Error ? e.message : String(e)).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        '',
      );
      const path = /changed-on-disk:(.+)$/.exec(text)?.[1];
      this.error = path ?? text;
      this.errorIsFile = path !== undefined;
    } finally {
      this.applying = false;
    }
  }
  dispose() {
    this.stop();
  }
}
