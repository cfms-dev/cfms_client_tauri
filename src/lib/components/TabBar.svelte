<script lang="ts">
  // MD3 NavigationBar — floating, blurred, rounded-capsule bottom tab bar.

  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { _ as t } from "svelte-i18n";
  import Icon from "./Icon.svelte";
  import type { IconName } from "$lib/icons";
  import { ripple } from "$lib/motion/actions";
  import { chromeStore } from "$lib/stores.svelte";

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

  const visibleTabs = $derived(tabs.filter((t) => !t.hidden));
  const lift = $derived(chromeStore.snackbarStackHeight);

  function isActive(href: string): boolean {
    return (
      page.url.pathname === href || page.url.pathname.startsWith(href + "/")
    );
  }

  let btnEls = $state<(HTMLButtonElement | null)[]>([]);

  let pill = $state<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  });

  let animate = $state(false);

  function measure() {
    const idx = visibleTabs.findIndex((t) => isActive(t.href));
    const el = idx >= 0 ? btnEls[idx] : null;

    if (el) {
      pill = {
        left: el.offsetLeft,
        width: el.offsetWidth,
        ready: true,
      };
    } else {
      pill = {
        ...pill,
        ready: false,
      };
    }
  }

  $effect(() => {
    void page.url.pathname;
    void visibleTabs.length;

    requestAnimationFrame(() => {
      measure();

      requestAnimationFrame(() => {
        animate = true;
      });
    });
  });

  $effect(() => {
    const onResize = () => measure();

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  });
</script>

<div
  class="fixed inset-x-0 z-40 flex justify-center px-4
         pointer-events-none motion-navbar-in"
  style={`bottom: calc(1.25rem + var(--safe-area-bottom, 0px) + ${lift}px); transition: bottom 520ms var(--motion-easing-emphasized-decelerate, cubic-bezier(0.05, 0.7, 0.1, 1));`}
>
  <nav
    class="pointer-events-auto relative flex items-stretch gap-1 p-1.5
           rounded-full border border-md3-outline/50
           bg-md3-surface-container/70 backdrop-blur-xl
           shadow-[0_12px_40px_-8px_rgba(0,0,0,0.55)]"
    aria-label={$t("nav.mainNavigation")}
  >
    <span
      class="absolute top-1.5 bottom-1.5 rounded-full bg-md3-primary shadow-lg pointer-events-none"
      style="left: 0;
             width: {pill.width}px;
             transform: translateX({pill.left}px);
             opacity: {pill.ready ? 1 : 0};
             transition: {animate
        ? 'transform 420ms var(--motion-easing-emphasized, cubic-bezier(0.2,0,0,1)), width 420ms var(--motion-easing-emphasized, cubic-bezier(0.2,0,0,1)), opacity 200ms ease'
        : 'opacity 200ms ease'};"
      aria-hidden="true"
    ></span>

    {#each visibleTabs as tab, i}
      <button
        bind:this={btnEls[i]}
        class="relative z-10 overflow-visible rounded-full
               flex flex-col items-center justify-center gap-0.5
               px-4 py-1.5 min-w-[3.75rem]
               transition-colors duration-300 active:scale-95"
        class:text-md3-on-primary={isActive(tab.href)}
        class:text-md3-on-surface-variant={!isActive(tab.href)}
        onclick={() => goto(tab.href)}
        aria-label={tab.label}
        aria-current={isActive(tab.href) ? "page" : undefined}
        use:ripple
      >
        <div class="relative">
          <Icon name={tab.icon} size="22px" />

          {#if tab.badge != null && tab.badge > 0}
            <span
              class="absolute -top-1.5 -right-3 min-w-[16px] h-4
                     flex items-center justify-center
                     bg-md3-error text-md3-on-error
                     text-[10px] font-bold rounded-full px-1
                     ring-2 ring-md3-surface-container"
            >
              {tab.badge > 99 ? "99+" : tab.badge}
            </span>
          {/if}
        </div>

        <span
          class="text-[11px] font-medium leading-none"
          class:font-semibold={isActive(tab.href)}
          style="font-family: var(--font-md3-sans);"
        >
          {tab.label}
        </span>
      </button>
    {/each}
  </nav>
</div>

<style>
  @media (prefers-reduced-motion: reduce) {
    div {
      transition: none !important;
    }
  }
</style>
