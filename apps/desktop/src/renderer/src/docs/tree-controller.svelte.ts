import { t } from '@skaro/ui';
import type { DocEntry } from '../../../shared/ipc';
import type { TreePropsContext } from './tree-props';

export function createTreeController(p: TreePropsContext) {
  let groups = $state({ adr: true, specs: true, docs: true });
  let resizing = $state(false);
  let menu = $state(false);
  let foot: HTMLDivElement | undefined = $state();

  const adrs = $derived(p.docs.entries.filter((d) => d.kind === 'adr'));
  const specs = $derived(p.docs.entries.filter((d) => d.kind === 'spec'));

  $effect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      if (foot && !foot.contains(e.target as Node)) menu = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') menu = false;
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', esc);
    };
  });
  const free = $derived(p.docs.entries.filter((d) => d.kind === 'doc'));
  const fixed = $derived(p.docs.all.slice(0, 2));

  function resize(e: MouseEvent): void {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = p.width;
    resizing = true;
    const move = (ev: MouseEvent) => (p.width = Math.max(200, Math.min(400, w0 + ev.clientX - x0)));
    const up = () => {
      resizing = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function tip(doc: DocEntry, missing: boolean): string | undefined {
    if (missing) return t('docs.missing');
    if (doc.adr?.status === 'proposed') return t('docs.adr.proposed.tip');
    if (doc.adr?.status === 'superseded')
      return t('docs.adr.replacedBy.tip', { id: doc.adr.replacedBy ?? '' });
    if (doc.spec?.status === 'proposed') return t('docs.spec.proposed.tip');
    if (doc.spec?.status === 'superseded')
      return t('docs.spec.replacedBy.tip', { id: doc.spec.replacedBy ?? '' });
    return undefined;
  }

  function pick(action: () => void): void {
    menu = false;
    action();
  }

  return {
    p,
    get groups() {
      return groups;
    },
    set groups(value: typeof groups) {
      groups = value;
    },
    get resizing() {
      return resizing;
    },
    get menu() {
      return menu;
    },
    set menu(value: typeof menu) {
      menu = value;
    },
    get foot() {
      return foot;
    },
    set foot(value: typeof foot) {
      foot = value;
    },
    get adrs() {
      return adrs;
    },
    get specs() {
      return specs;
    },
    get free() {
      return free;
    },
    get fixed() {
      return fixed;
    },
    resize,
    tip,
    pick,
  };
}

export type TreeController = ReturnType<typeof createTreeController>;
