<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ProjectInfo } from '../../../shared/ipc';
  import ProjectsBoard from './ProjectsBoard.svelte';

  /** "Проекты": the start screen without projects, else the board of project cards. */
  let {
    projects,
    onopen,
    onadd,
    onsettings,
    onchanged,
  }: {
    projects: ProjectInfo[];
    onopen: (id: string) => void;
    onadd: () => void;
    onsettings: () => void;
    onchanged: () => void;
  } = $props();

  const uid = $props.id();
  const gradient = `sk-mark-${uid}`;
</script>

{#if projects.length === 0}
  <div class="empty">
    <div class="mark">
      <svg width="28" height="28" viewBox="0 0 127 127" aria-hidden="true">
        <defs>
          <linearGradient id={gradient} x1="0%" x2="0%" y1="100%" y2="0%">
            <stop offset="0%" stop-color="rgb(129,0,70)" />
            <stop offset="16%" stop-color="rgb(168,0,40)" />
            <stop offset="32%" stop-color="rgb(232,0,44)" />
            <stop offset="48%" stop-color="rgb(255,0,0)" />
            <stop offset="64%" stop-color="rgb(255,66,0)" />
            <stop offset="81%" stop-color="rgb(255,84,0)" />
            <stop offset="99%" stop-color="rgb(255,90,0)" />
          </linearGradient>
        </defs>
        <path
          fill-rule="evenodd"
          fill="url(#{gradient})"
          d="M63.500,126.999 C28.429,126.999 0.0,98.570 0.0,63.500 C0.0,59.33 0.466,54.677 1.343,50.471 C5.174,62.937 16.778,72.0 30.500,72.0 C47.344,72.0 60.999,58.344 60.999,41.500 C60.999,24.655 47.344,11.0 30.500,11.0 C29.513,11.0 28.539,11.51 27.577,11.142 C37.795,4.118 50.164,0.0 63.500,0.0 C98.570,0.0 126.999,28.429 126.999,63.500 C126.999,98.570 98.570,126.999 63.500,126.999 Z"
        />
      </svg>
    </div>
    <div class="copy">
      <div class="empty-title">{t('home.empty.title')}</div>
      <div class="empty-text">{t('home.empty.text')}</div>
    </div>
    <button type="button" class="create" onclick={onadd}>
      <Icon name="plus" size={15} stroke={2.6} />{t('home.empty.create')}
    </button>
  </div>
{:else}
  <ProjectsBoard {onopen} {onadd} {onsettings} {onchanged} />
{/if}

<style>
  /* 07 · Проекты, empty state: centred in the whole content area. */
  .empty {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    text-align: center;
  }

  .mark {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 16px;
    background: var(--sk-fill-15);
  }

  .copy {
    max-width: 440px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty-title {
    font-size: var(--sk-fs-14);
    font-weight: 700;
    color: var(--sk-text-5);
  }

  .empty-text {
    font-size: var(--sk-fs-8);
    line-height: 1.6;
    color: var(--sk-text-17);
    text-wrap: pretty;
  }

  .create {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 18px;
    border: none;
    border-radius: var(--sk-radius);
    background: var(--sk-accent);
    color: var(--sk-text-1);
    font-size: var(--sk-fs-8);
    font-weight: 700;
    cursor: pointer;
  }

  .create:hover {
    background: var(--sk-accent-hover);
  }

  .create:active {
    transform: translateY(1px);
  }
</style>
