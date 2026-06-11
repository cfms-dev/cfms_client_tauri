<script lang="ts">
  // Welcome info card for the Home overview page.
  //
  // Reference: HomeView / WelcomeInfoCard in reference/src/include/ui/components/homepage.py

  import Icon from './Icon.svelte';
  import { _ as t } from 'svelte-i18n';
  import { hoverLift, reveal } from '$lib/motion/actions';
  import { flyScale } from '$lib/motion/transitions';
</script>

<div
  class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
         border border-md3-outline p-5 flex items-start gap-4"
  transition:flyScale={{ y: 14, duration: 320 }}
  use:hoverLift
  use:reveal
>
  <span class="text-md3-primary-emphasis shrink-0 mt-0.5">
    <Icon name="guardian" size="40px" />
  </span>
  <div>
    <h1
      class="text-lg font-bold text-md3-on-surface"
      style="font-family: var(--font-md3-sans);"
    >
      {$t('home.welcomeTitle')}
    </h1>
    <p class="text-sm text-md3-on-surface-variant mt-1.5 leading-relaxed">
      {$t('home.welcomeBody')}
    </p>
  </div>
</div>
