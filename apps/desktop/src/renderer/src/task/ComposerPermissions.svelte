<script lang="ts">
  import type { PermissionMode } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import type { ComposerController } from './composer-controller.svelte';
  let {
    controller,
    permissionMode,
    permissionModes,
    onpermission,
  }: {
    controller: ComposerController;
    permissionMode?: PermissionMode;
    permissionModes: readonly PermissionMode[];
    onpermission?: (mode: PermissionMode) => void;
  } = $props();
</script>

{#if permissionMode && onpermission}
  <div class="pop-anchor">
    <button
      type="button"
      class="pill"
      class:warn={permissionMode === 'full'}
      class:on={controller.menu === 'perm'}
      data-tip={t('composer.perm.tip')}
      onclick={() => (controller.menu = controller.menu === 'perm' ? undefined : 'perm')}
    >
      <Icon name="shield" size={13} stroke={2} />
      {t(`composer.perm.${permissionMode}`)}
      <Icon name="chevronDown" size={11} stroke={2.4} />
    </button>
    {#if controller.menu === 'perm'}
      <div class="pop perm">
        {#each permissionModes as id (id)}
          {@const p = { id, warn: id === 'full' }}
          {@const on = p.id === permissionMode}
          <button
            type="button"
            class="perm-row"
            class:on
            onclick={() => {
              controller.menu = undefined;
              if (!on) onpermission(p.id);
            }}
          >
            <span
              class="check"
              style="color: {on ? (p.warn ? 'var(--sk-warn)' : 'var(--sk-accent)') : 'transparent'}"
            >
              <Icon name="check" size={13} stroke={2.6} />
            </span>
            <span class="texts">
              <span class="label" class:warn={on && p.warn}>{t(`composer.perm.${p.id}`)}</span>
              <span class="note">{t(`composer.perm.${p.id}.note`)}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
