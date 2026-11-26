<script lang="ts">
  import { useFeed } from './context.svelte';
  import { drawMermaid } from './mermaid';
  import { agentMarkdown } from './markdown-work';
  import { MarkdownDom } from './markdown-dom';
  import { markdownInteractions } from './markdown-interactions';
  import { useFeedLoading } from './feed-loading.svelte';
  import { onMount } from 'svelte';

  let { text, streaming = false }: { text: string; streaming?: boolean } = $props();
  const feed = useFeed();
  const interactions = markdownInteractions(feed);
  let root = $state<HTMLDivElement>();
  let parts = $state.raw<string[]>([]);
  let renderer = $state.raw<MarkdownDom>();
  let painted = $state(false);
  let prepared = $state(false);
  let failed = $state(false);
  let visible = $state(false);
  const loading = useFeedLoading();
  const token = Symbol('markdown');
  onMount(() => {
    if (!root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
      },
      { root: root.closest('.scroller') },
    );
    observer.observe(root);
    return () => observer.disconnect();
  });
  $effect(() => {
    loading?.track(token, visible && !failed && !painted && !!text);
    return () => loading?.track(token, false);
  });

  $effect(() => {
    const request = agentMarkdown(text);
    let current = true;
    failed = false;
    prepared = false;
    void request.result
      .then((value) => {
        if (current) {
          parts = value;
          prepared = true;
        }
      })
      .catch((error) => {
        if (current) {
          failed = true;
          feed.historyError?.(String(error));
        }
      });
    return () => {
      current = false;
      request.cancel();
    };
  });
  $effect(() => {
    if (!root) return;
    const dom = new MarkdownDom(
      root,
      (fragment) => {
        void interactions.decorate(fragment);
        return () => {};
      },
      () => {
        painted = true;
      },
    );
    renderer = dom;
    return () => dom.destroy();
  });
  $effect(() => {
    const dom = renderer;
    const element = root;
    const pending = streaming;
    if (!dom || !element || !prepared) return;
    if (!parts.length) painted = true;
    let current = true;
    void dom
      .update(parts)
      .then(() => {
        if (current) return drawMermaid(element, pending);
      })
      .catch((error) => {
        if (current) {
          failed = true;
          feed.historyError?.(String(error));
        }
      });
    return () => {
      current = false;
      dom.cancel();
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="md"
  class:loading={!painted && !!text}
  bind:this={root}
  onclick={interactions.onclick}
></div>

<style>
  .md.loading {
    min-height: 1lh;
  }
  .md :global(.md-remote-label) {
    flex: 1;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-19);
  }
</style>
