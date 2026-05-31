<script lang="ts">
  // MD3 NavigationBar — bottom tab bar for the home layout.
  //
  // Renders 4–5 tabs with Material Symbol icons.  The active tab is
  // highlighted with MD3 primary colour.  An optional badge is shown
  // on the tasks tab (active download count).
  //
  // Reference: HomeNavigationBar in reference/src/include/ui/models/home.py

  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Icon from './Icon.svelte';
  import type { IconName } from '$lib/icons';

  interface Tab {
    href: string;
    label: string;
    icon: IconName;
    badge?: number;
    hidden?: boolean;
  }

  interface Props {
    tabs: Tab[];
  }

  let { tabs }: Props = $props();

  function isActive(href: string): boolean {
    return $page.url.pathname === href || $page.url.pathname.startsWith(href + '/');
  }
</script>

<nav
  class="flex items-end bg-md3-surface-container/95 backdrop-blur-sm
         border-t border-md3-outline shrink-0"
  aria-label="Main navigation"
>
  {#each tabs.filter((t) => !t.hidden) as tab}
    <button
      class="flex-1 flex flex-col items-center justify-center gap-0.5
             py-2 px-1 min-w-0 transition-colors
             hover:bg-md3-surface-container-high/50"
      class:text-md3-primary={isActive(tab.href)}
      class:text-md3-on-surface-variant={!isActive(tab.href)}
      onclick={() => goto(tab.href)}
      aria-label={tab.label}
      aria-current={isActive(tab.href) ? 'page' : undefined}
    >
      <div class="relative">
        <Icon name={tab.icon} size="24px" />
        {#if tab.badge != null && tab.badge > 0}
          <span
            class="absolute -top-1 -right-2.5 min-w-[16px] h-4
                   flex items-center justify-center
                   bg-md3-error text-md3-on-error
                   text-[10px] font-bold rounded-full px-1"
          >
            {tab.badge > 99 ? '99+' : tab.badge}
          </span>
        {/if}
      </div>
      <span
        class="text-xs font-medium"
        class:font-semibold={isActive(tab.href)}
        style="font-family: var(--font-md3-sans);"
      >
        {tab.label}
      </span>
    </button>
  {/each}
</nav>
