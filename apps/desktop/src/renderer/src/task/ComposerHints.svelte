<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ComposerController } from './composer-controller.svelte';
  import './composer-hints.css';
  let { controller }: { controller: ComposerController } = $props();
</script>

{#if controller.menu === 'slash'}
  <div class="menu">
    {#each controller.slashRows as command, i (command.name)}
      <button
        type="button"
        class="slash-row"
        class:hl={i === controller.highlighted}
        onclick={() => controller.pickCommand(command)}
        onpointerenter={() => (controller.highlighted = i)}
      >
        <span class="cmd">/{command.name}</span>
        <span class="note">{command.description}</span>
      </button>
    {:else}
      <div class="empty">{t('composer.slash.empty')}</div>
    {/each}
  </div>
{:else if controller.menu === 'at'}
  <div class="menu at">
    <div class="search">
      <Icon name="search" size={14} stroke={2} color="var(--sk-text-18)" />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        placeholder={t('composer.at.placeholder')}
        bind:value={controller.atQuery}
        autofocus
        oninput={() => {
          controller.highlighted = 0;
          void controller.refreshAt();
        }}
        onkeydown={controller.onkeydown}
      />
    </div>
    <div class="at-rows">
      {#each controller.atRows as row, i (row.path)}
        <button
          type="button"
          class="at-row"
          class:hl={i === controller.highlighted}
          onclick={() => controller.pickPath(row)}
          onpointerenter={() => (controller.highlighted = i)}
        >
          <Icon
            name={row.kind === 'folder' ? 'folderOpen' : 'file'}
            size={13}
            stroke={1.9}
            color="var(--sk-text-20)"
          />
          <span>{row.path}</span>
        </button>
      {:else}
        <div class="empty">{t('composer.at.empty')}</div>
      {/each}
    </div>
  </div>
{/if}
