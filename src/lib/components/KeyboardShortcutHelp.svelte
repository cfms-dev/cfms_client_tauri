<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import ShortcutKeys from '$lib/components/ShortcutKeys.svelte';
  import {
    commandGroup,
    commandLabel,
    keyboardCommands,
    type KeyboardCommand,
  } from '$lib/keyboard';

  let {
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  } = $props();

  const visibleCommands = $derived(
    $keyboardCommands.filter((command) => command.scope === 'global' || command.scope === 'page'),
  );
  const globalCommands = $derived(visibleCommands.filter((command) => command.scope === 'global'));
  const pageCommands = $derived(visibleCommands.filter((command) => command.scope === 'page'));

  function uniqueCommands(commands: KeyboardCommand[]) {
    const seen = new Set<string>();
    return commands.filter((command) => {
      if (seen.has(command.id)) return false;
      seen.add(command.id);
      return true;
    });
  }
</script>

{#if open}
  <ModalFrame
    title={$t('keyboard.title')}
    maxWidth="max-w-2xl"
    closeLabel={$t('common.close')}
    onClose={onClose}
  >
    <div class="shortcut-help">
      <p class="shortcut-intro">{$t('keyboard.description')}</p>

      <section aria-labelledby="shortcut-global-heading">
        <h3 id="shortcut-global-heading">{$t('keyboard.global')}</h3>
        <div class="shortcut-list">
          {#each uniqueCommands(globalCommands) as command (command.id)}
            <div class="shortcut-row">
              <span>{commandLabel(command)}</span>
              <ShortcutKeys shortcuts={command.shortcuts} />
            </div>
          {/each}
        </div>
      </section>

      {#if pageCommands.length > 0}
        <section aria-labelledby="shortcut-page-heading">
          <h3 id="shortcut-page-heading">{commandGroup(pageCommands[0]) || $t('keyboard.currentPage')}</h3>
          <div class="shortcut-list">
            {#each uniqueCommands(pageCommands) as command (command.id)}
              <div class="shortcut-row">
                <span>{commandLabel(command)}</span>
                <ShortcutKeys shortcuts={command.shortcuts} />
              </div>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </ModalFrame>
{/if}

<style>
  .shortcut-help { display: grid; gap: 1.25rem; padding: 1.25rem; }
  .shortcut-intro { color: var(--color-md3-on-surface-variant); font-size: 0.875rem; line-height: 1.6; }
  section { display: grid; gap: 0.55rem; }
  h3 { color: var(--color-md3-on-surface); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
  .shortcut-list { overflow: hidden; border: 1px solid var(--color-md3-outline); border-radius: var(--explorer-radius-medium, 10px); }
  .shortcut-row { display: flex; min-height: 45px; align-items: center; justify-content: space-between; gap: 1rem; border-bottom: 1px solid var(--color-md3-outline); padding: 0.55rem 0.75rem; color: var(--color-md3-on-surface); font-size: 0.84rem; }
  .shortcut-row:last-child { border-bottom: 0; }
</style>
