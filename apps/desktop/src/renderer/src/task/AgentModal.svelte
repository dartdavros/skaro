<script lang="ts">
  import type { PermissionMode } from '@skaro/timeline';
  import { Button, Modal, RadioCards, t, Toggle } from '@skaro/ui';
  import type { AgentInfo, AgentSettings } from '../../../shared/ipc';
  import { agentName } from '../feed/format';
  import { createAgentModalController } from './agent-modal-controller.svelte';
  import AgentPicker from './AgentPicker.svelte';
  import AgentModelFields from './AgentModelFields.svelte';
  import './agent-modal.css';

  /**
   * "Агент задачи" (mockup 7a): agent, model and effort from the agent, permission mode,
   * isolation, plan first. Applies to the next request. "Агент чата" (AgentChat mockup): agent,
   * model and effort; chat permissions are selected in the composer.
   */
  let {
    open = $bindable(false),
    kind = 'task',
    projectId,
    settings,
    agents,
    locked,
    branch,
    sandboxHolds,
    onsave,
  }: {
    open?: boolean;
    kind?: 'task' | 'chat';
    projectId: string;
    settings: AgentSettings;
    agents: AgentInfo[];
    /** A started task keeps its agent (sessions are not compatible). */
    locked: boolean;
    branch?: string;
    sandboxHolds?: boolean;
    onsave: (settings: AgentSettings) => Promise<void> | void;
  } = $props();

  const permOptions = $derived<
    { value: PermissionMode; label: string; note: string; warn?: boolean }[]
  >([
    { value: 'ask', label: t('agent.perm.ask'), note: t('agent.perm.ask.note') },
    {
      value: 'auto',
      label: t('agent.perm.auto'),
      note: sandboxHolds === false ? t('agent.perm.autoNoSandbox.note') : t('agent.perm.auto.note'),
    },
    { value: 'full', label: t('agent.perm.full'), note: t('agent.perm.full.note'), warn: true },
  ]);
  const isoOptions = $derived<{ value: 'worktree' | 'in-place'; label: string; note: string }[]>([
    {
      value: 'worktree',
      label: t('agent.iso.worktree'),
      note: t('agent.iso.worktree.note', { branch: branch ?? 'skaro/…' }),
    },
    { value: 'in-place', label: t('agent.iso.inplace'), note: t('agent.iso.inplace.note') },
  ]);

  const controller = createAgentModalController({
    projectId: () => projectId,
    settings: () => settings,
    open: () => open,
    agents: () => agents,
    locked: () => locked,
    close: () => {
      open = false;
    },
    onsave: (next) => onsave(next),
  });

  /** "Claude Code · Opus 4.1 · Высокое": what saving applies. */
  const summary = $derived(
    [
      agentName(controller.draft.agent),
      controller.model?.name,
      controller.efforts.find((e) => e.id === (controller.draft.effort ?? controller.effortDefault))
        ?.label ?? controller.efforts.find((e) => e.id === controller.effortDefault)?.label,
    ]
      .filter(Boolean)
      .join(' · '),
  );
</script>

<Modal
  bind:open
  flush
  width={480}
  title={kind === 'chat' ? t('chat.agent.title') : t('agent.modal.title')}
  subtitle={kind === 'chat'
    ? locked
      ? t('chat.agent.locked')
      : t('chat.agent.subtitle')
    : locked
      ? t('agent.modal.locked')
      : t('agent.modal.subtitle')}
>
  <div class="body agent-settings">
    <div class="section">
      <span class="sk-label">{t('agent.agent')}</span>
      <AgentPicker {agents} draft={controller.draft} {locked} />
    </div>

    <AgentModelFields {controller} />

    {#if kind === 'task'}
      <div class="section">
        <span class="sk-label">{t('agent.perm')}</span>
        <RadioCards
          options={permOptions}
          bind:value={controller.draft.permissionMode}
          label={t('agent.perm')}
        />
      </div>

      <div class="section">
        <span class="sk-label">{t('agent.iso')}</span>
        <RadioCards
          options={isoOptions}
          bind:value={controller.draft.isolation}
          label={t('agent.iso')}
        />
      </div>

      <div class="plan-first">
        <span class="texts">
          <span class="name">{t('agent.planFirst')}</span>
          <span class="note-line">{t('agent.planFirst.note')}</span>
        </span>
        <Toggle bind:checked={controller.draft.planFirst} />
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <span class="agent-summary">{summary}</span>
    <Button onclick={() => (open = false)}>{t('agent.cancel')}</Button>
    <Button variant="primary" disabled={controller.saving} onclick={() => void controller.save()}
      >{t('agent.save')}</Button
    >
  {/snippet}
</Modal>
