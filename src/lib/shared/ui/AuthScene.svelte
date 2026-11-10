<script lang="ts">
  import type { Snippet } from 'svelte';

  let { view, animate = false, children }: {
    view: 'connect' | 'login';
    animate?: boolean;
    children: Snippet;
  } = $props();
</script>

<div
  class="auth-scene workspace-palette"
  class:auth-scene--login={view === 'login'}
  class:auth-scene--animated={animate}
  class:auth-scene--return={view === 'connect' && animate}
>
  <!-- These siblings must stay outside the scrolling form. Only the opaque
       cover moves or fades; clipping/fading a backdrop ancestor changes its sampling. -->
  <div class="auth-scene-background" aria-hidden="true"></div>
  <div class="auth-scene-material" aria-hidden="true"></div>
  <div class="auth-scene-cover" aria-hidden="true"></div>
  {@render children()}
  <div class="auth-scene-visual" aria-hidden="true">
    <img src="/astronomy.jpg" alt="" class="auth-scene-image" />
  </div>
</div>

<style>
  @property --auth-scene-progress {
    syntax: '<number>';
    inherits: true;
    initial-value: 0;
  }

  .auth-scene {
    --auth-scene-progress: 0;
    --auth-scene-panel-width: calc(100% - (100% - var(--auth-panel-basis)) * var(--auth-scene-progress));
    position: relative;
    display: flex;
    min-height: 100%;
    overflow: hidden;
    background: var(--explorer-background);
  }

  .auth-scene--login {
    --auth-scene-progress: 1;
  }

  .auth-scene--animated {
    animation: auth-scene-progress var(--auth-transition-duration)
      var(--auth-transition-easing) both;
  }

  .auth-scene--return {
    /* Reverse the endpoints, not the easing, so both directions start promptly. */
    animation-name: auth-scene-progress-return;
  }

  .auth-scene-background,
  .auth-scene-material,
  .auth-scene-cover,
  .auth-scene-visual {
    display: none;
    pointer-events: none;
  }

  .auth-scene :global(.auth-scene-panel) {
    z-index: 4;
    min-width: 0;
  }

  @supports ((backdrop-filter: blur(20px)) or (-webkit-backdrop-filter: blur(20px))) {
    .auth-scene-background,
    .auth-scene-material,
    .auth-scene-cover {
      position: absolute;
      display: block;
      inset: 0;
    }

    .auth-scene-background {
      z-index: 0;
      background: url('/astronomy.jpg') center / cover;
    }

    .auth-scene-material {
      z-index: 1;
      background: var(--cfms-account-acrylic);
      -webkit-backdrop-filter: var(--cfms-material-filter);
      backdrop-filter: var(--cfms-material-filter);
    }

    .auth-scene-cover {
      z-index: 2;
      background: var(--explorer-background);
      opacity: calc(1 - var(--auth-scene-progress));
    }

    .auth-scene :global(.auth-scene-panel) {
      background: transparent;
    }
  }

  @media (min-width: 1024px) {
    .auth-scene :global(.auth-scene-panel) {
      flex-basis: var(--auth-scene-panel-width);
    }

    .auth-scene-visual {
      position: absolute;
      inset: 0;
      z-index: 3;
      display: block;
      overflow: hidden;
      background: var(--explorer-background);
      /* Clip only the clear-image sibling, never a backdrop ancestor. Keep
         its final crop stable while the panel boundary reveals it. */
      clip-path: inset(0 0 0 var(--auth-scene-panel-width));
      opacity: calc(0.96 + 0.04 * var(--auth-scene-progress));
    }

    .auth-scene-image {
      position: absolute;
      right: 0;
      height: 100%;
      width: calc(100% - var(--auth-panel-basis));
      object-fit: cover;
      transform: translate3d(calc(18% * (1 - var(--auth-scene-progress))), 0, 0)
        scale(calc(1 + 0.04 * (1 - var(--auth-scene-progress))));
    }

    @supports ((backdrop-filter: blur(20px)) or (-webkit-backdrop-filter: blur(20px))) {
      .auth-scene-material {
        right: auto;
        width: var(--auth-scene-panel-width);
      }

      .auth-scene-cover {
        opacity: 1;
        transform-origin: left center;
        transform: scaleX(calc(1 - var(--auth-scene-progress)));
      }
    }
  }

  /* With motion disabled, the unanimated view value is the destination. */
  :global(html[data-reduce-motion='true']) .auth-scene {
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(html:not([data-reduce-motion='false'])) .auth-scene {
      animation: none;
    }
  }

  @media (prefers-reduced-transparency: reduce), (forced-colors: active) {
    .auth-scene-background,
    .auth-scene-material,
    .auth-scene-cover {
      display: none;
    }

    .auth-scene--login :global(.auth-scene-panel) {
      background: var(--colorNeutralBackground2);
    }
  }

  @media (forced-colors: active) {
    .auth-scene--login :global(.auth-scene-panel) {
      background: Canvas;
    }
  }

  @keyframes auth-scene-progress {
    from { --auth-scene-progress: 0; }
    to { --auth-scene-progress: 1; }
  }

  @keyframes auth-scene-progress-return {
    from { --auth-scene-progress: 1; }
    to { --auth-scene-progress: 0; }
  }
</style>
