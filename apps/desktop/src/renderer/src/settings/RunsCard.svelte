<script lang="ts">
  import { t, Toggle } from '@skaro/ui';
  import { AUTO_MERGE_KEY } from '../../../shared/ipc';
  import Row from './Row.svelte';
  import Section from './Section.svelte';
  import { Setting } from './setting.svelte';

  /** Whether a task whose criteria are all ticked is merged automatically or with the card. */
  const autoMerge = new Setting<boolean>(AUTO_MERGE_KEY, false);
</script>

<Section title={t('settings.runs')}>
  <Row tall title={t('settings.autoMerge')} note={t('settings.autoMerge.note')}>
    <Toggle
      ariaLabel={t('settings.autoMerge')}
      bind:checked={() => autoMerge.value, (on) => autoMerge.set(on)}
    />
  </Row>
</Section>
