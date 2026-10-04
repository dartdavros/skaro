<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { TaskDetail } from '../../../shared/ipc';
  import TaskDescriptionHeader from './TaskDescriptionHeader.svelte';
  import './task-description.css';
  import StatusChip from './StatusChip.svelte';

  /**
   * Right panel of the task screen: task and stage headers, status, links (the specification among them),
   * goal, criteria with their requirements R-n, notes.
   */
  let {
    task,
    oncollapse,
    ontoggle,
    onspec,
  }: {
    task: TaskDetail;
    oncollapse: () => void;
    ontoggle: (index: number) => void;
    /** Opens the specification in "Документы". */
    onspec: (path: string) => void;
  } = $props();

  /** "R-2 Проверка прав…": the requirement the criterion names, and the rest of its text. */
  function requirement(text: string): { id: string; tip: string; rest: string } | undefined {
    const m = /^(R-\d+)\s+(.*)$/s.exec(text);
    if (!m) return undefined;
    const req = task.requirements?.find((r) => r.id === m[1]);
    return { id: m[1]!, tip: req ? `${req.id} · ${req.text}` : m[1]!, rest: m[2]! };
  }
</script>

<div class="desc task-description">
  <TaskDescriptionHeader {task} {oncollapse} />
  <div class="meta">
    <StatusChip status={task.status} />
    {#if task.dependsOn.length}
      <div class="line">
        {t('task.dependsOn')}
        {#each task.dependsOn as dep (dep.id)}
          <span class="ref" data-tip={`${dep.title} · ${t(`task.status.${dep.status}`)}`}>
            {#if dep.status === 'done'}<Icon name="check" size={11} stroke={2.4} />{/if}{dep.id}
          </span>
        {/each}
      </div>
    {/if}
    {#if task.blocks.length}
      <div class="line">
        {t('task.blocks')}
        {#each task.blocks as ref (ref.id)}
          <span class="ref" data-tip={ref.title}>{ref.id}</span>
        {/each}
      </div>
    {/if}
    {#if task.spec}
      {@const spec = task.spec}
      <div class="line">
        {t('task.spec')}
        <button
          type="button"
          class="spec"
          data-tip={t('task.spec.tip', { title: spec.title })}
          onclick={() => onspec(spec.path)}>SPEC-{spec.id}</button
        >
      </div>
    {/if}
    {#if task.branch}
      <div class="branch" data-tip={t('task.branch.tip')}>
        <Icon name="branch" size={12} stroke={1.9} />
        <span>{task.branch}</span>
      </div>
    {/if}
  </div>

  <div class="sep"></div>

  {#if task.goal}
    <div class="section">
      <span class="sk-label">{t('task.goal')}</span>
      <p class="goal">{task.goal}</p>
    </div>
  {/if}

  {#if task.criteria.length}
    <div class="section" style="gap: 9px">
      <span class="sk-label">{t('task.criteria')}</span>
      <div class="criteria">
        {#each task.criteria as criterion, i (i)}
          {@const req = requirement(criterion.text)}
          <button type="button" class="criterion" onclick={() => ontoggle(i)}>
            <span class="box" class:done={criterion.done}>
              {#if criterion.done}<Icon
                  name="check"
                  size={11}
                  stroke={3.2}
                  color="var(--sk-text-3)"
                />{/if}
            </span>
            <span class="text" class:done={criterion.done}
              >{#if req}<span class="req" data-tip={req.tip}>{req.id}</span>
                {req.rest}{:else}{criterion.text}{/if}</span
            >
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if task.notes}
    <div class="section">
      <span class="sk-label">{t('task.notes')}</span>
      <p class="notes">{task.notes}</p>
    </div>
  {/if}

  {#if task.summary}
    <div class="section">
      <span class="sk-label">{t('task.summary')}</span>
      <p class="notes">{task.summary}</p>
    </div>
  {/if}
</div>
