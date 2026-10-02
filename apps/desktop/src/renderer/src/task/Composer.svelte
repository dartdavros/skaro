<script lang="ts">
  import type { AgentCommand, PermissionMode } from '@skaro/timeline';
  import type { AgentId, MessageInput, PathSuggestion } from '../../../shared/ipc';
  import { createComposerController } from './composer-controller.svelte';
  import ComposerHints from './ComposerHints.svelte';
  import ComposerAttachments from './ComposerAttachments.svelte';
  import ComposerBar from './ComposerBar.svelte';
  import './composer.css';

  /**
   * Composer (Composer mockup, "Лента агента" 6 and 10): text, "/" commands, "@" files, attachments,
   * permission and plan pills, context fill, model button, send / queue / stop.
   */
  let {
    placeholder,
    running,
    agent,
    model,
    modelTip,
    contextPct,
    permissionMode,
    permissionModes = ['ask', 'auto', 'full'],
    planFirst,
    imagesSupported = true,
    commands,
    suggest,
    onsend,
    onstop,
    onmodel,
    onpermission,
  }: {
    placeholder: string;
    running: boolean;
    agent: AgentId;
    model: string;
    /** Tip of the model button; the chat says the agent is fixed. */
    modelTip?: string;
    contextPct?: number;
    permissionMode?: PermissionMode;
    permissionModes?: readonly PermissionMode[];
    planFirst: boolean;
    imagesSupported?: boolean;
    commands: () => Promise<AgentCommand[]>;
    suggest: (query: string) => Promise<PathSuggestion[]>;
    onsend: (input: MessageInput) => Promise<void> | void;
    onstop: () => void;
    onmodel: () => void;
    onpermission?: (mode: PermissionMode) => void;
  } = $props();

  const controller = createComposerController({
    commands: () => commands(),
    suggest: (query) => suggest(query),
    onsend: (input) => onsend(input),
  });
  export function prefill(value: string): void {
    controller.prefill(value);
  }
  export async function attach(kind: 'files' | 'folder'): Promise<void> {
    await controller.attach(kind);
  }
</script>

<div class="composer" bind:this={controller.root}>
  <ComposerHints {controller} />
  <ComposerAttachments {controller} {imagesSupported} />
  <textarea
    bind:this={controller.textarea}
    bind:value={controller.text}
    rows="2"
    {placeholder}
    oninput={() => void controller.oninput()}
    onkeydown={controller.onkeydown}></textarea>
  <ComposerBar
    {controller}
    {running}
    {agent}
    {model}
    {modelTip}
    {contextPct}
    {permissionMode}
    {permissionModes}
    {planFirst}
    {onstop}
    {onmodel}
    {onpermission}
  />
</div>
