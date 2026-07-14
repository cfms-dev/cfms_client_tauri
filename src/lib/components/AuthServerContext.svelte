<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { smoothPosition } from '$lib/motion/actions';

  let { label }: { label: string } = $props();
</script>

<header class="auth-server-context" aria-label={label} use:smoothPosition>
  <div class="auth-server-context__label">
    <Icon name="login" size="19px" />
    <span>{label}</span>
  </div>
  <div class="auth-server-context__divider"></div>
</header>

<style>
  .auth-server-context {
    display: grid;
    width: calc(100% + 2.5rem);
    gap: 0.8rem;
    margin-inline: -1.25rem;
  }

  .auth-server-context__label {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.55rem;
    padding-left: 0.75rem;
    color: var(--explorer-text-muted);
    font-size: 0.82rem;
    font-weight: 560;
    text-align: left;
  }

  .auth-server-context__label span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .auth-server-context__divider {
    height: 1px;
    background: var(--explorer-border-strong);
  }
</style>
