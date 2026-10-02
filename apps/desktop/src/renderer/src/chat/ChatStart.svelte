<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import './chat-start.css';
  let {
    hasCode,
    onimport,
    onprefill,
  }: { hasCode: boolean; onimport: () => void; onprefill: (text: string) => void } = $props();
  /** Start screen (D-32): a project with code starts from a feature or a fix, a new one from an idea. */
  const chips = $derived<{ label: string; tip: string; prefill?: string }[]>(
    hasCode
      ? [
          {
            label: t('chat.chip.feature'),
            prefill: t('chat.chip.feature.text'),
            tip: t('chat.chip.prefill.tip', { text: t('chat.chip.feature.text').trim() }),
          },
          {
            label: t('chat.chip.fix'),
            prefill: t('chat.chip.fix.text'),
            tip: t('chat.chip.prefill.tip', { text: t('chat.chip.fix.text').trim() }),
          },
          { label: t('chat.chip.import'), tip: t('chat.chip.import.tip') },
        ]
      : [
          { label: t('chat.chip.idea'), prefill: '', tip: '' },
          { label: t('chat.chip.import'), tip: t('chat.chip.import.tip') },
        ],
  );

  function chip(c: { prefill?: string }): void {
    if (c.prefill === undefined) onimport();
    else onprefill(c.prefill);
  }
</script>

<div class="empty">
  <span class="empty-title">{hasCode ? t('chat.empty.code.title') : t('chat.empty.title')}</span>
  <span class="empty-text">{hasCode ? t('chat.empty.code.text') : t('chat.empty.text')}</span>
  <div class="chips">
    {#each chips as c (c.label)}
      <button type="button" class="chip" data-tip={c.tip || undefined} onclick={() => chip(c)}
        >{#if c.prefill === undefined}<Icon
            name="import"
            size={13}
            stroke={1.9}
          />{/if}{c.label}</button
      >
    {/each}
  </div>
</div>
