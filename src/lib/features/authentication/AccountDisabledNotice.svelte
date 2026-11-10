<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';

  let {
    title,
    username,
    description,
    requestTimeLabel,
    requestTime,
    backLabel,
    reason,
    onBack,
  }: {
    title: string;
    username: string;
    description: string;
    requestTimeLabel: string;
    requestTime: string;
    backLabel: string;
    reason: string;
    onBack: () => void;
  } = $props();
</script>

<section class="account-disabled-notice" aria-labelledby="account-disabled-title" aria-live="polite">
  <div class="account-disabled-heading">
    <h1 id="account-disabled-title">{title}</h1>
    <div class="account-disabled-identity" title={username}>
      <Icon name="accountCircle" size="18px" />
      <span>{username}</span>
    </div>
  </div>

  <aside class="account-disabled-reason">
    <span class="cfms-icon-text__icon account-disabled-reason__icon">
      <Icon name="warningAmber" size="21px" />
    </span>
    <p>{reason}</p>
  </aside>

  <div class="account-disabled-details">
    <p class="account-disabled-description">{description}</p>

    <dl class="account-disabled-request-time">
      <div>
        <dt>{requestTimeLabel}</dt>
        <dd>{requestTime}</dd>
      </div>
    </dl>
  </div>

  <FluentButton data-fluent-owner="lib-components-account-disabled-notice"
    type="button"
    onclick={onBack}
    appearance="subtle"
    class="account-disabled-back"
  >
    <span class="account-disabled-back__icon">
      <Icon name="arrowBack" size="20px" />
    </span>
    <span class="account-disabled-back__label">{backLabel}</span>
  </FluentButton>
</section>

<style>
  .account-disabled-notice {
    display: flex;
    width: 100%;
    flex-direction: column;
    align-items: center;
    color: var(--explorer-text);
    text-align: center;
    animation: account-disabled-enter var(--motion-duration-medium3)
      var(--motion-easing-emphasized-decelerate) both;
  }

  .account-disabled-heading {
    display: grid;
    justify-items: center;
    gap: 12px;
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    color: var(--explorer-text);
    font-family: var(--font-md3-sans);
    font-size: clamp(1.55rem, 4vw, 1.85rem);
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.2;
  }

  .account-disabled-identity {
    display: flex;
    max-width: min(100%, 18rem);
    align-items: center;
    gap: 8px;
    color: var(--explorer-text-muted);
    font-size: 14px;
    font-weight: 560;
  }

  .account-disabled-identity span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .account-disabled-reason {
    display: grid;
    width: 100%;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 12px;
    margin-top: 2.15rem;
    border: 1px solid color-mix(in srgb, var(--explorer-warning) 36%, transparent);
    border-radius: var(--explorer-radius-large);
    padding: 1rem 1.05rem;
    color: var(--explorer-text);
    background: color-mix(in srgb, var(--explorer-warning) 12%, var(--explorer-surface));
    text-align: left;
  }

  .account-disabled-reason__icon {
    --cfms-icon-line-height: calc(14px * 1.55);
    color: var(--explorer-warning);
  }

  .account-disabled-reason p {
    font-size: 14px;
    font-weight: 400;
    line-height: 1.55;
  }

  .account-disabled-details {
    width: 100%;
    margin-top: 2rem;
    text-align: left;
  }

  .account-disabled-description {
    color: var(--explorer-text-muted);
    font-size: 14px;
    line-height: 1.65;
  }

  .account-disabled-request-time {
    margin: 1.7rem 0 0;
    text-align: center;
  }

  .account-disabled-request-time div {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: center;
    gap: 0.4rem 0.65rem;
    font-size: 12px;
    line-height: 1.5;
  }

  .account-disabled-request-time dt {
    color: var(--explorer-text-muted);
  }

  .account-disabled-request-time dd {
    margin: 0;
    color: var(--explorer-text);
    font-variant-numeric: tabular-nums;
  }

  :global(.account-disabled-back[data-fluent-owner="lib-components-account-disabled-notice"]) {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 1.5rem;
    border: 0;
    border-radius: 0;
    padding: 0.55rem 0.35rem;
    color: var(--color-md3-primary-emphasis, var(--color-md3-primary));
    background: transparent;
    font-family: var(--font-md3-sans);
    font-size: 14px;
    font-weight: 600;
    transition:
      color var(--motion-duration-short4) var(--motion-easing-standard),
      filter var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .account-disabled-back__icon,
  .account-disabled-back__label {
    display: inline-flex;
  }

  :global(.account-disabled-back[data-fluent-owner="lib-components-account-disabled-notice"]:hover) {
    color: var(--colorBrandForegroundLinkHover);
    filter: drop-shadow(0 0 5px color-mix(in srgb, currentColor 32%, transparent));
  }

  @keyframes account-disabled-enter {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.985);
      filter: blur(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
    }
  }

</style>
