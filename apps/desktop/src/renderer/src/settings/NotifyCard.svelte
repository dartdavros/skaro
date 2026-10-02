<script lang="ts">
  import { Checkbox, t, Toggle } from '@skaro/ui';
  import Card from './Card.svelte';
  import { Setting } from './setting.svelte';

  /** "Уведомления": which task events show a system notification, with or without sound. */
  const KINDS = [
    ['need', true],
    ['review', true],
    ['error', true],
    ['merged', false],
  ] as const;
  const kinds = KINDS.map(([kind, on]) => ({
    kind,
    setting: new Setting<boolean>(`notify.${kind}`, on),
  }));
  const sound = new Setting<boolean>('notify.sound', true);
</script>

<Card label={t('settings.notify')}>
  <div class="list">
    {#each kinds as { kind, setting } (kind)}
      <Checkbox
        checked={setting.value}
        label={t(`settings.notify.${kind}`)}
        onchange={(on) => setting.set(on)}
      />
    {/each}
    <div class="line"></div>
    <Toggle
      label={t('settings.notify.sound')}
      bind:checked={() => sound.value, (on) => sound.set(on)}
    />
  </div>
</Card>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .line {
    height: 1px;
    margin: 2px 0;
    background: var(--sk-line-strong);
  }
</style>
