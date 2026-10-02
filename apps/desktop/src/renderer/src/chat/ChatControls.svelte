<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { AgentInfo } from '../../../shared/ipc';
  import type { ChatController } from './chat-controller.svelte';
  import PinnedZone from '../feed/PinnedZone.svelte';
  import Composer from '../task/Composer.svelte';
  import AgentModal from '../task/AgentModal.svelte';
  import './chat-controls.css';
  let {
    controller,
    projectId,
    chatId,
    agents,
  }: {
    controller: ChatController;
    projectId: string;
    chatId: string | undefined;
    agents: AgentInfo[];
  } = $props();
  let composer: Composer | undefined = $state();
  export function prefill(text: string): void {
    composer?.prefill(text);
  }
</script>

{#if controller.archived}
  <div class="bottom">
    <div class="archived">
      <Icon name="archive" size={14} stroke={1.8} color="var(--sk-text-22)" />
      <span class="archived-text">{t('chat.archived')}</span>
      <button type="button" class="restore" onclick={() => controller.setArchived(false)}
        >{t('chat.restore')}</button
      >
    </div>
  </div>
{:else if controller.settings}
  {@const settings = controller.settings}
  <div class="bottom">
    {#if controller.timeline}<PinnedZone timeline={controller.timeline} />{/if}
    <Composer
      bind:this={composer}
      placeholder={controller.view?.chat.kind === 'import'
        ? t('chat.import.placeholder')
        : t('chat.placeholder')}
      running={controller.running}
      agent={controller.agentInfo?.id ?? controller.settings.agent}
      model={controller.modelLabel}
      modelTip={t('chat.model.tip')}
      {...controller.timeline?.usage?.contextUsedPct !== undefined
        ? { contextPct: controller.timeline.usage.contextUsedPct }
        : {}}
      permissionMode={controller.settings.permissionMode ?? 'ask'}
      permissionModes={['ask', 'full']}
      onpermission={controller.setPermission}
      planFirst={false}
      commands={() => window.skaro.invoke('agents.commands', settings.agent, projectId)}
      suggest={(q) => window.skaro.invoke('files.suggest', projectId, '', q)}
      onsend={controller.send}
      onstop={() => {
        const chat = chatId;
        if (chat) void window.skaro.invoke('chat.interrupt', projectId, chat);
      }}
      onmodel={() => (controller.modal = true)}
    />
  </div>
{/if}
{#if controller.modalSettings}
  <AgentModal
    bind:open={controller.modal}
    kind="chat"
    {projectId}
    settings={controller.modalSettings}
    {agents}
    locked={chatId !== undefined}
    onsave={controller.saveAgentSettings}
  />
{/if}
