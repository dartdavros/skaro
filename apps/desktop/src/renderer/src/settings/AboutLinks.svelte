<script lang="ts">
  import { ArrowUpRight, BookOpen, Bug, Globe } from '@lucide/svelte';
  import { t } from '@skaro/ui';
  import { ABOUT_LINKS, ABOUT_RESOURCES } from './about-links';

  const icons = { help: BookOpen, site: Globe, issues: Bug };

  function open(event: MouseEvent, url: string): void {
    event.preventDefault();
    void window.skaro.invoke('shell.openExternal', url);
  }
</script>

<div class="resources">
  {#each ABOUT_RESOURCES as resource (resource.id)}
    {@const ResourceIcon = icons[resource.id]}
    <a
      class="resource"
      href={ABOUT_LINKS[resource.id]}
      onclick={(event) => open(event, ABOUT_LINKS[resource.id])}
    >
      <span class="resource-icon"><ResourceIcon size={18} strokeWidth={1.7} /></span>
      <span class="resource-copy">
        <span class="label">{t(`settings.link.${resource.id}`)}</span>
        <span class="address">{resource.address}</span>
      </span>
      <span class="external"><ArrowUpRight size={16} /></span>
    </a>
  {/each}
  <a class="author" href={ABOUT_LINKS.author} onclick={(event) => open(event, ABOUT_LINKS.author)}>
    <span class="author-label">{t('settings.link.author')}</span>
    <span class="author-name">Andrey Ermolaev <ArrowUpRight size={14} /></span>
  </a>
</div>

<style>
  .resources {
    overflow: hidden;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
  }

  a {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 18px 20px;
    color: var(--sk-text);
    text-decoration: none;
    transition: background 0.12s ease;
  }

  a + a {
    border-top: 1px solid var(--sk-line-strong);
  }

  a:hover {
    background: var(--sk-surface-hover);
  }

  a:focus-visible {
    outline: 2px solid var(--sk-link);
    outline-offset: -2px;
  }

  .resource-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 38px;
    height: 38px;
    border-radius: var(--sk-radius);
    background: var(--sk-surface-2);
    color: var(--sk-icon);
  }

  .resource-copy {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

  .label {
    color: var(--sk-text-bright);
    font-size: var(--sk-fs-6);
    font-weight: 600;
  }

  .address {
    color: var(--sk-text-muted);
    font-size: var(--sk-fs-4);
    overflow-wrap: anywhere;
  }

  .external {
    display: flex;
    flex: none;
    color: var(--sk-text-muted);
  }

  a:hover .external,
  a:hover .author-name {
    color: var(--sk-link-hover);
  }

  .author {
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 16px;
    font-size: var(--sk-fs-5);
  }

  .author-label {
    color: var(--sk-text-muted);
  }

  .author-name {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--sk-link);
    font-weight: 600;
  }
</style>
