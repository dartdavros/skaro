<script lang="ts">
  import { t } from '@skaro/ui';
  import type { Snippet } from 'svelte';
  import CopyButton from './CopyButton.svelte';

  /** "Скопировать" under the final answer of a turn (mockups 5a, 9g). */
  let {
    text,
    offset = -8,
    children,
  }: {
    text: string;
    offset?: number;
    /** Shown after the button (the time at the end of a turn). */
    children?: Snippet;
  } = $props();
</script>

<div class="fd-after-final" style="margin-top: {offset}px">
  <CopyButton {text} label={t('feed.msg.copy')} />
  {@render children?.()}
</div>
