<script lang="ts">
  import { t, Toggle } from '@skaro/ui';
  import { AUTO_MERGE_KEY } from '../../../shared/ipc';
  import Row from './Row.svelte';
  import Section from './Section.svelte';
  import { Setting } from './setting.svelte';

  /**
   * "Выполнение": how many tasks run at once (1–8), the rest wait in the queue; whether a task
   * whose criteria are all ticked is merged on its own or with the card.
   */
  const slots = new Setting<number>('runs.slots', 3);
  const autoMerge = new Setting<boolean>(AUTO_MERGE_KEY, false);
</script>

<Section title={t('settings.runs')}>
  <Row tall title={t('settings.runs.slots')} note={t('settings.runs.note')}>
    <div class="stepper">
      <button
        type="button"
        data-tip={t('settings.runs.less')}
        onclick={() => slots.set(Math.max(1, slots.value - 1))}>−</button
      >
      <span class="value">{slots.value}</span>
      <button
        type="button"
        data-tip={t('settings.runs.more')}
        onclick={() => slots.set(Math.min(8, slots.value + 1))}>+</button
      >
    </div>
  </Row>
  <Row tall title={t('settings.autoMerge')} note={t('settings.autoMerge.note')}>
    <Toggle
      ariaLabel={t('settings.autoMerge')}
      bind:checked={() => autoMerge.value, (on) => autoMerge.set(on)}
    />
  </Row>
</Section>

<style>
  .stepper {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--sk-deep);
  }

  button {
    width: 28px;
    height: 27px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-text-17);
    font-size: var(--sk-fs-10);
    cursor: pointer;
  }

  button:hover {
    background: var(--sk-surface-2);
    color: var(--sk-text-6);
  }

  .value {
    min-width: 30px;
    text-align: center;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-6);
    color: var(--sk-text-2);
  }
</style>
