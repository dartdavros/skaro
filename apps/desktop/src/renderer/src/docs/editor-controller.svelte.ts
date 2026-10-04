import { tick } from 'svelte';
import { applyFormat, type Format } from './format';
import { renderDoc } from './render';
import type { EditorProps } from './editor-props';

export function createEditorController(p: EditorProps) {
  let view = $state<'editor' | 'preview' | 'split'>('split');
  let area: HTMLTextAreaElement | undefined = $state();
  const rendered = $derived(renderDoc(p.docs.draft));

  $effect(() => {
    area?.focus();
  });

  async function format(kind: Format): Promise<void> {
    if (!area) return;
    const next = applyFormat(kind, p.docs.draft, area.selectionStart, area.selectionEnd);
    p.docs.draft = next.text;
    await tick();
    area.focus();
    area.setSelectionRange(next.start, next.end);
  }

  function keys(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'b' || key === 'i') {
      e.preventDefault();
      void format(key === 'b' ? 'bold' : 'italic');
    }
  }

  return {
    p,
    get view() {
      return view;
    },
    set view(value: typeof view) {
      view = value;
    },
    get area() {
      return area;
    },
    set area(value: typeof area) {
      area = value;
    },
    get rendered() {
      return rendered;
    },
    format,
    keys,
  };
}

export type EditorController = ReturnType<typeof createEditorController>;
