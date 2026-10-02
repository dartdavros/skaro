<script lang="ts">
  import ChatSessions from './ChatSessions.svelte';
  import ChatPane from './ChatPane.svelte';
  import './i18n';
  import type { ChatScreenProps } from './chat-screen-props';
  import { createChatScreenController } from './chat-screen-controller.svelte';
  let { project, agents, chat = $bindable(), onsection, onimport }: ChatScreenProps = $props();
  const state = createChatScreenController({
    get project() {
      return project;
    },
    get agents() {
      return agents;
    },
    get chat() {
      return chat;
    },
    set chat(value: typeof chat) {
      chat = value;
    },
    get onsection() {
      return onsection;
    },
    get onimport() {
      return onimport;
    },
  });
  import './chat-screen.css';
</script>

<div data-chat-screen class="chat">
  <ChatSessions {state} />

  {#if chat !== undefined}
    {#key chat}
      <ChatPane
        projectId={project.id}
        projectPath={project.path}
        {agents}
        chatId={chat === 'new' ? undefined : chat}
        oncreated={(id) => {
          chat = id;
          void state.list.reload();
        }}
        {onsection}
        {onimport}
      />
    {/key}
  {/if}
</div>
