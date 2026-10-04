<script lang="ts">
  import { Checkbox, t, Toggle } from '@skaro/ui';
  import Row from './Row.svelte';
  import Section from './Section.svelte';
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

<Section title={t('settings.notify')} note={t('settings.notify.note')}>
  <div class="kinds">
    {#each kinds as { kind, setting } (kind)}
      <div class="kind">
        <Checkbox
          checked={setting.value}
          label={t(`settings.notify.${kind}`)}
          onchange={(on) => setting.set(on)}
        />
      </div>
    {/each}
  </div>
  <Row tall title={t('settings.notify.sound')}>
    <Toggle
      ariaLabel={t('settings.notify.sound')}
      bind:checked={() => sound.value, (on) => sound.set(on)}
    />
  </Row>
</Section>

<style>
  .kinds {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    padding: 8px;
  }

  /* The whole cell is the checkbox: 36px, lit on hover. */
  .kind :global(.row) {
    width: 100%;
    padding: 9px 10px;
    border-radius: 8px;
  }

  .kind :global(.row:hover) {
    background: var(--sk-fill-20);
  }
</style>
