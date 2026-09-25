<script lang="ts">
  import type { Interaction } from '@skaro/timeline';
  import { Icon, Segmented, t } from '@skaro/ui';
  import { useFeed } from './context.svelte';

  /** A form an MCP server asks the user to fill (mockup 9f). */
  let { interaction }: { interaction: Extract<Interaction, { kind: 'form' }> } = $props();

  const feed = useFeed();
  // A card lives for one interaction.
  // svelte-ignore state_referenced_locally
  let values = $state<Record<string, string | number | boolean>>(
    Object.fromEntries(
      interaction.fields.map((f) => [
        f.id,
        f.type === 'boolean' ? false : f.type === 'select' ? (f.options?.[0] ?? '') : '',
      ]),
    ),
  );
  let sending = $state(false);

  const ready = $derived(
    interaction.fields.every(
      (f) => !f.required || f.type === 'boolean' || String(values[f.id] ?? '').trim() !== '',
    ),
  );

  async function answer(action: 'accept' | 'decline'): Promise<void> {
    if (sending) return;
    sending = true;
    try {
      await feed.respond(interaction.id, {
        kind: 'form',
        action,
        ...(action === 'accept'
          ? {
              values: Object.fromEntries(
                interaction.fields.map((f) => [
                  f.id,
                  f.type === 'number' ? Number(values[f.id]) : values[f.id]!,
                ]),
              ),
            }
          : {}),
      });
    } finally {
      sending = false;
    }
  }
</script>

<div class="fd-card" style="gap: 11px">
  <span class="fd-label">{interaction.server}</span>
  <span class="fd-card-q">{interaction.title}</span>
  {#each interaction.fields as field (field.id)}
    {#if field.type === 'boolean'}
      <button
        type="button"
        class="check-row"
        onclick={() => (values[field.id] = !values[field.id])}
      >
        <span class="fd-check" class:on={values[field.id] === true}
          ><Icon name="check" size={11} stroke={3.2} /></span
        >
        <span>{field.label}</span>
      </button>
    {:else}
      <div class="field">
        <span class="fd-label">{field.label}</span>
        {#if field.type === 'select' && field.options && field.options.length <= 4}
          <Segmented
            bind:value={() => String(values[field.id] ?? ''), (v) => (values[field.id] = v)}
            options={field.options.map((o) => ({ value: o, label: o }))}
          />
        {:else if field.type === 'select'}
          <select class="fd-input" style="height: 32px" bind:value={values[field.id]}>
            {#each field.options ?? [] as option (option)}<option value={option}>{option}</option
              >{/each}
          </select>
        {:else}
          <input
            class="fd-input"
            style="height: 32px; {field.type === 'number'
              ? 'width: 110px; flex: none; font-family: var(--sk-mono)'
              : ''}"
            type={field.type === 'number' ? 'number' : 'text'}
            bind:value={values[field.id]}
          />
        {/if}
      </div>
    {/if}
  {/each}
  <div class="fd-card-actions">
    <button type="button" class="fd-btn" disabled={sending} onclick={() => void answer('decline')}
      >{t('card.form.decline')}</button
    >
    <button
      type="button"
      class="fd-btn primary"
      disabled={!ready || sending}
      onclick={() => void answer('accept')}>{t('card.form.send')}</button
    >
  </div>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: 12.5px;
    color: #c8c8c8;
    cursor: pointer;
    text-align: left;
  }

  .check-row .fd-check {
    margin-top: 0;
  }
</style>
