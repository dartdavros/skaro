<script lang="ts">
  import { Icon, t } from '@skaro/ui';

  /** Copies `text`; the icon turns into a check for a moment. */
  let { text, label }: { text: string; label: string } = $props();

  let copied = $state(false);

  function copy(): void {
    void navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<button
  type="button"
  class="fd-icon-btn"
  data-tip={copied ? t('feed.msg.copied') : label}
  aria-label={label}
  onclick={copy}
>
  <Icon name={copied ? 'check' : 'copy'} size={14} stroke={copied ? 2.2 : 1.9} />
</button>
