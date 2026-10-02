<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import { localImageUrl } from '../feed/format';
  import type { ComposerController } from './composer-controller.svelte';
  import './composer-attachments.css';
  let {
    controller,
    imagesSupported,
  }: { controller: ComposerController; imagesSupported: boolean } = $props();
</script>

{#if controller.attachments.length}
  <div class="attachments">
    {#each controller.attachments.filter((a) => a.kind === 'image') as image (image.path)}
      <div
        class="thumb"
        data-tip={imagesSupported ? image.path.split(/[\\/]/).pop() : t('composer.image.noSupport')}
      >
        <img src={localImageUrl(image.path)} alt="" />
        {#if !imagesSupported}
          <span class="warn"><Icon name="warning" size={10} stroke={2.6} /></span>
        {/if}
        <button
          type="button"
          class="remove-thumb"
          data-tip={t('composer.chip.remove')}
          aria-label={t('composer.chip.remove')}
          onclick={() =>
            (controller.attachments = controller.attachments.filter((a) => a !== image))}
        >
          <Icon name="close" size={9} stroke={3} />
        </button>
      </div>
    {/each}
    {#each controller.attachments.filter((a) => a.kind !== 'image') as file (file.path)}
      <span
        class="chip"
        data-tip={file.kind === 'folder' ? t('composer.chip.folder') : t('composer.chip.file')}
      >
        <Icon
          name={file.kind === 'folder' ? 'folderOpen' : 'file'}
          size={13}
          stroke={1.9}
          color="var(--sk-text-20)"
        />
        <span class="chip-label"
          >{file.path.split(/[\\/]/).filter(Boolean).pop()}{file.kind === 'folder' ? '/' : ''}</span
        >
        <button
          type="button"
          class="chip-remove"
          data-tip={t('composer.chip.remove')}
          aria-label={t('composer.chip.remove')}
          onclick={() =>
            (controller.attachments = controller.attachments.filter((a) => a !== file))}
        >
          <Icon name="close" size={10} stroke={2.8} />
        </button>
      </span>
    {/each}
  </div>
{/if}
