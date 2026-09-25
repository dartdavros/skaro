<script lang="ts">
  import { t } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import { hostOf, localImageUrl } from './format';
  import { drawMermaid, renderMarkdown } from './markdown';

  /** Agent text rendered from Markdown; links to files only where the file exists. */
  let { text }: { text: string } = $props();

  const feed = useFeed();
  let root: HTMLDivElement | undefined = $state();
  const html = $derived(renderMarkdown(text));

  $effect(() => {
    void html;
    const el = root;
    if (!el) return;
    void drawMermaid(el);
    decorate(el);
  });

  /** Paths that exist become links; images get their previews. */
  async function decorate(el: HTMLElement): Promise<void> {
    const paths = [...el.querySelectorAll<HTMLElement>('code.md-path:not([data-checked])')];
    for (const code of paths) code.dataset['checked'] = '1';
    if (paths.length) {
      const found = new Set(await feed.existing(paths.map((p) => p.dataset['path'] ?? '')));
      for (const code of paths) {
        const path = code.dataset['path'] ?? '';
        if (!found.has(path)) continue;
        code.classList.add('exists');
        const line = /:(\d+)(?::\d+)?$/.exec(path)?.[1];
        code.dataset['tip'] = line ? t('md.openLine', { n: line }) : t('md.openFile');
      }
    }
    for (const span of el.querySelectorAll<HTMLElement>('.md-local-image:not([data-checked])')) {
      span.dataset['checked'] = '1';
      const img = document.createElement('img');
      img.src = localImageUrl(resolveLocal(span.dataset['path'] ?? ''));
      img.alt = span.dataset['alt'] ?? '';
      img.onerror = () => span.replaceChildren(document.createTextNode(t('feed.image.error')));
      span.replaceChildren(img);
    }
    for (const span of el.querySelectorAll<HTMLElement>('.md-remote-image:not([data-checked])')) {
      span.dataset['checked'] = '1';
      const label = document.createElement('span');
      label.className = 'md-remote-label';
      label.textContent = `${t('feed.image.remote')} · ${hostOf(span.dataset['src'] ?? '')}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fd-btn';
      button.dataset['remoteShow'] = '1';
      button.dataset['tip'] = t('feed.image.showTip');
      button.textContent = t('feed.image.show');
      span.replaceChildren(label, button);
    }
    for (const button of el.querySelectorAll<HTMLElement>('.md-copy')) {
      button.dataset['tip'] = t('md.copy');
    }
  }

  function resolveLocal(path: string): string {
    if (/^([a-zA-Z]:[\\/]|\/)/.test(path) || !feed.cwd) return path;
    return `${feed.cwd.replace(/[\\/]$/, '')}/${path}`;
  }

  function onclick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const copy = target.closest<HTMLElement>('.md-copy');
    if (copy) {
      const code = copy.closest('.md-code')?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard.writeText(code);
      copy.classList.add('copied');
      copy.dataset['tip'] = t('md.copied');
      setTimeout(() => {
        copy.classList.remove('copied');
        copy.dataset['tip'] = t('md.copy');
      }, 1500);
      return;
    }
    const path = target.closest<HTMLElement>('code.md-path.exists');
    if (path) {
      feed.openPath(path.dataset['path'] ?? '');
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a[data-external]');
    if (link) {
      event.preventDefault();
      feed.openExternal(link.href);
      return;
    }
    const show = target.closest<HTMLElement>('[data-remote-show]');
    if (show) {
      const span = show.closest<HTMLElement>('.md-remote-image');
      if (!span) return;
      // Loaded only on the user's click: the page asked for it, not Skaro.
      const img = document.createElement('img');
      img.src = span.dataset['src'] ?? '';
      img.alt = span.dataset['alt'] ?? '';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => span.replaceChildren(document.createTextNode(t('feed.image.error')));
      img.onclick = () => feed.viewImage(img.src);
      span.replaceChildren(img);
      return;
    }
    const image = target.closest<HTMLImageElement>('.md-local-image img');
    if (image) feed.viewImage(image.src);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md" bind:this={root} {onclick}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify in renderMarkdown -->
  {@html html}
</div>

<style>
  .md :global(.md-remote-label) {
    flex: 1;
    font-size: 12px;
    color: #8a8a8a;
  }
</style>
