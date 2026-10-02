<script lang="ts">
  import { t } from '@skaro/ui';
  import { CATEGORIES, type SettingsCategory } from './categories';

  /** The left column of "Настройки": title, categories, "changes are saved right away". */
  let { current, onpick }: { current: SettingsCategory; onpick: (id: SettingsCategory) => void } =
    $props();
</script>

<aside class="set-nav">
  <div class="titles">
    <span class="title">{t('settings.title')}</span>
    <span class="subtitle">{t('settings.subtitle')}</span>
  </div>
  {#each CATEGORIES as c (c.id)}
    <button
      type="button"
      class="item"
      class:on={c.id === current}
      aria-current={c.id === current ? 'page' : undefined}
      onclick={() => onpick(c.id)}
    >
      <svg
        class="icon"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"><path d={c.icon} /></svg
      >{t(`settings.cat.${c.id}`)}
    </button>
  {/each}
  <span class="spacer"></span>
  <span class="saved" data-tip={t('settings.saved.tip')}>
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
    >{t('settings.saved')}
  </span>
</aside>

<style>
  .set-nav {
    flex: none;
    width: 236px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 22px 12px 18px 18px;
    border-right: 1px solid var(--sk-line);
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 0 10px 16px;
  }

  .title {
    font-size: var(--sk-fs-12);
    font-weight: 700;
    color: var(--sk-text-5);
    letter-spacing: -0.01em;
  }

  .subtitle {
    font-size: var(--sk-fs-3);
    line-height: 1.4;
    color: var(--sk-text-21);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 30px;
    padding: 0 10px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-13);
    font-size: var(--sk-fs-6);
    font-weight: 400;
    text-align: left;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .item:hover {
    color: var(--sk-text-bright);
  }

  .item.on {
    background: var(--sk-surface);
    color: var(--sk-text-bright);
    font-weight: 600;
  }

  .icon {
    flex: none;
    color: var(--sk-text-23);
  }

  .item.on .icon {
    color: var(--sk-text-6);
  }

  .spacer {
    flex: 1;
  }

  .saved {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 10px;
    font-size: var(--sk-fs-2);
    color: var(--sk-text-23);
  }
</style>
