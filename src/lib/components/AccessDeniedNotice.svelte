<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';

  let {
    title,
    description,
    subject = '',
    details = [],
    actionLabel = '',
    presentation = 'page',
    onAction,
  }: {
    title: string;
    description: string;
    subject?: string;
    details?: Array<{ label: string; value: string }>;
    actionLabel?: string;
    presentation?: 'page' | 'dialog';
    onAction?: () => void;
  } = $props();
</script>

<section
  class="access-denied-notice"
  class:access-denied-notice--dialog={presentation === 'dialog'}
  aria-label={title}
  aria-live="polite"
>
  <div class="access-denied-icon" aria-hidden="true">
    <Icon name="lock" size={presentation === 'dialog' ? '44px' : '54px'} />
    <span class="access-denied-badge">
      <Icon name="remove" size={presentation === 'dialog' ? '13px' : '15px'} />
    </span>
  </div>

  <div class="access-denied-copy">
    <h2>{title}</h2>
    <p>{description}</p>
  </div>

  {#if subject}
    <div class="access-denied-subject" title={subject}>
      <Icon name="filePresent" size="18px" />
      <span>{subject}</span>
    </div>
  {/if}

  {#if details.length > 0}
    <dl class="access-denied-details">
      {#each details as detail}
        <div class="access-denied-detail-row">
          <dt>{detail.label}</dt>
          <dd title={detail.value}>{detail.value}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  {#if actionLabel && onAction}
    <button
      type="button"
      class="access-denied-action"
      onclick={onAction}
    >
      {#if presentation === 'page'}
        <Icon name="arrowBack" size="18px" />
      {/if}
      <span>{actionLabel}</span>
    </button>
  {/if}
</section>

<style>
  .access-denied-notice {
    display: flex;
    width: 100%;
    min-height: 100%;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 1.05rem;
    padding: 3rem 1.5rem;
    color: var(--explorer-text, var(--color-md3-on-surface));
    text-align: center;
    animation: access-denied-enter 320ms var(--motion-easing-emphasized-decelerate) both;
  }

  .access-denied-notice--dialog {
    min-height: 0;
    gap: 0.9rem;
    padding: 2rem 2rem 1.5rem;
    color: var(--color-md3-on-surface);
  }

  .access-denied-icon {
    position: relative;
    display: grid;
    width: 78px;
    height: 78px;
    place-items: center;
    color: color-mix(in srgb, var(--color-md3-on-surface-variant) 84%, var(--color-md3-on-surface));
  }

  .access-denied-notice--dialog .access-denied-icon {
    width: 66px;
    height: 66px;
  }

  .access-denied-badge {
    position: absolute;
    right: 1px;
    bottom: 9px;
    display: grid;
    width: 27px;
    height: 27px;
    place-items: center;
    border: 3px solid var(--explorer-background, var(--color-md3-surface-container));
    border-radius: 999px;
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
    box-shadow: 0 6px 15px color-mix(in srgb, var(--color-md3-primary) 34%, transparent);
  }

  .access-denied-notice--dialog .access-denied-badge {
    right: 1px;
    bottom: 8px;
    width: 23px;
    height: 23px;
    border-width: 3px;
    border-color: var(--color-md3-surface-container);
  }

  .access-denied-copy {
    display: grid;
    max-width: 34rem;
    gap: 0.55rem;
  }

  h2, p { margin: 0; }
  h2 { font-size: clamp(1.25rem, 2vw, 1.6rem); font-weight: 680; letter-spacing: -0.02em; }
  p { color: var(--explorer-text-muted, var(--color-md3-on-surface-variant)); font-size: 0.95rem; line-height: 1.65; }

  .access-denied-subject {
    display: flex;
    min-width: 0;
    max-width: min(100%, 28rem);
    align-items: center;
    gap: 0.6rem;
    padding: 0.2rem 0.1rem;
    color: var(--color-md3-on-surface);
    font-size: 0.9rem;
    font-weight: 600;
  }

  .access-denied-subject span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .access-denied-details {
    display: grid;
    width: min(100%, 28rem);
    gap: 0.55rem;
    margin: -0.15rem 0 0;
    border-top: 1px solid var(--color-md3-outline);
    padding: 0.9rem 0.1rem 0;
  }

  .access-denied-detail-row {
    display: grid;
    min-width: 0;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    align-items: baseline;
    gap: 0.85rem;
    font-size: 0.78rem;
    line-height: 1.45;
    text-align: left;
  }

  .access-denied-detail-row dt {
    color: var(--color-md3-on-surface-variant);
  }

  .access-denied-detail-row dd {
    min-width: 0;
    margin: 0;
    color: var(--color-md3-on-surface);
    overflow-wrap: anywhere;
  }

  .access-denied-action {
    display: inline-flex;
    min-height: 40px;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    border: 0;
    border-radius: 999px;
    padding: 0.55rem 1.15rem;
    color: var(--color-md3-primary-emphasis, var(--color-md3-primary));
    background: transparent;
    font-size: 0.88rem;
    font-weight: 650;
    transition:
      background-color var(--motion-duration-short3) var(--motion-easing-standard),
      border-color var(--motion-duration-short3) var(--motion-easing-standard),
      transform var(--motion-duration-short3) var(--motion-easing-standard);
  }

  .access-denied-action:hover {
    background: color-mix(in srgb, var(--color-md3-primary) 10%, transparent);
  }

  .access-denied-action:active {
    background: color-mix(in srgb, var(--color-md3-primary) 16%, transparent);
    transform: scale(0.97);
  }

  .access-denied-notice--dialog .access-denied-action {
    min-width: 8rem;
    margin-top: 0.25rem;
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
  }

  .access-denied-notice--dialog .access-denied-action:hover {
    background: color-mix(in srgb, var(--color-md3-primary) 88%, white);
  }

  .access-denied-notice--dialog .access-denied-action:active {
    background: color-mix(in srgb, var(--color-md3-primary) 82%, black);
  }

  @keyframes access-denied-enter {
    from { opacity: 0; transform: translateY(10px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .access-denied-notice { animation: none; }
    .access-denied-action { transition: none; }
  }
</style>
