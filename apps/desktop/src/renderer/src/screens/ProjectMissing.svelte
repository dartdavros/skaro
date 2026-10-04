<script lang="ts">
  import { t } from '@skaro/ui';
  import type { ProjectCard } from '../../../shared/ipc';
  let {
    c,
    relocate,
    remove,
  }: {
    c: ProjectCard;
    relocate: (card: ProjectCard) => Promise<void>;
    remove: (id: string) => Promise<void>;
  } = $props();
</script>

<div class="missing">
  <div class="missing-line">
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--sk-error)"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path d="M4 19V6a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"
      ></path><path d="m10 11 4 4M14 11l-4 4"></path></svg
    >
    <span>{t('projects.missing')}</span>
  </div>
  <div class="missing-actions">
    <button
      type="button"
      class="find"
      onclick={(e) => {
        e.stopPropagation();
        void relocate(c);
      }}>{t('projects.find')}</button
    >
    <button
      type="button"
      class="drop"
      onclick={(e) => {
        e.stopPropagation();
        void remove(c.id);
      }}>{t('projects.remove')}</button
    >
  </div>
</div>
