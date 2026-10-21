<script lang="ts">
  import type { C4View } from '@skaro/core/c4-view';
  import { Icon, t } from '@skaro/ui';
  import { viewKindIcons } from './view-kinds';
  let { views, onopen }: { views: C4View[]; onopen: (viewId: string) => void } = $props();
</script>

<ul class="c4-list" data-c4-list>
  {#each views as view (view.id)}
    <li>
      <button type="button" data-c4-row={view.id} onclick={() => onopen(view.id)}>
        <span class="heading">
          <Icon name={viewKindIcons[view.kind]} size={16} />
          <span class="title">{view.title}</span>
        </span>
        <span class="kind">{t(`c4.${view.kind}`)}</span>
        <span class="state">{t(`c4.${view.state}`)}</span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .c4-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: 9px;
    overflow: hidden;
  }
  button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 140px 210px;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 40px;
    padding: 9px 12px;
    border: 0;
    border-bottom: 1px solid var(--sk-fill-3);
    background: var(--sk-surface);
    color: var(--sk-text-17);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover {
    background: var(--sk-surface-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--sk-link);
    outline-offset: -2px;
  }
  li:last-child button {
    border-bottom: 0;
  }
  .heading {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--sk-fs-6);
    font-weight: 600;
    color: var(--sk-text-6);
  }
  .kind,
  .state {
    font-size: var(--sk-fs-3);
  }
  .state {
    text-align: right;
  }
  @media (max-width: 1000px) {
    button {
      grid-template-columns: minmax(0, 1fr) 110px 160px;
    }
  }
</style>
