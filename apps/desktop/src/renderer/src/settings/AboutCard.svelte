<script lang="ts">
  import { t } from '@skaro/ui';
  import logo from '../../../../build/icon.png';
  import AboutLinks from './AboutLinks.svelte';
  import AboutVersion from './AboutVersion.svelte';
  import Section from './Section.svelte';
  import { exportDiagnostics } from './diagnostics-export';
  import './diagnostics-i18n';
</script>

<Section title={t('settings.about')} bare>
  <div class="about">
    <div class="identity">
      <img src={logo} alt="Skaro" width="88" height="88" />
      <h1>Skaro</h1>
      <AboutVersion />
    </div>
    <AboutLinks />
    <button type="button" class="diagnostics" onclick={() => void exportDiagnostics()}
      >{t('diagnostics.export')}</button
    >
  </div>
</Section>

<style>
  .about {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 24px;
  }

  .identity {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px 16px 8px;
  }

  img {
    object-fit: contain;
  }

  h1 {
    margin: 16px 0 8px;
    font-size: 32px;
    line-height: 1.2;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--sk-text-bright);
  }

  .diagnostics {
    align-self: center;
    padding: 4px 8px;
    border: none;
    border-radius: var(--sk-radius-sm);
    background: transparent;
    color: var(--sk-text-muted);
    font-size: var(--sk-fs-4);
    cursor: pointer;
  }

  .diagnostics:hover {
    background: var(--sk-hover);
    color: var(--sk-text);
  }
</style>
