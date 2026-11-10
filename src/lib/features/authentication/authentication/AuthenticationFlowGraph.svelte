<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type { AuthPolicyStep, AuthPurpose, UserAuthentication } from '$lib/api';
  import { authMethodName, canCompleteChain, credentialName } from '$lib/features/authentication/auth-policy-editor';
  import Icon from '$lib/shared/ui/Icon.svelte';
  let { chains, purpose, credentials, selectedChain, selectedStep, onSelect }: {
    chains: AuthPolicyStep[][]; purpose: AuthPurpose; credentials: UserAuthentication['credentials'];
    selectedChain: number; selectedStep: number; onSelect: (chain: number, step: number) => void;
  } = $props();
  function summary(step: AuthPolicyStep): string {
    return step.credential_ids.map((id) => {
      const credential = credentials.find((c) => c.credential_id === id && c.method === step.method);
      return credential ? credentialName(credential, authMethodName(step.method, $t)) : $t('authManagement.missingCredential');
    }).join(' / ') || $t('authManagement.selectCredential');
  }
</script>

<div class="flow-graph" aria-label={$t(`authManagement.purposes.${purpose}`)}>
  {#if chains.length}
    <div class="graph-caption">{$t('authManagement.anyAlternative')} · {$t('authManagement.inOrder')}</div>
    <div class="graph-network">
    <div class="terminal terminal-start"><Icon name="login" size="17px" /><span>{$t('authManagement.start')}</span></div>
    <ol class="branches">
      {#each chains as chain, chainIndex}
        <li class="branch" class:unavailable={!canCompleteChain(chain, credentials)}>
          <span class="branch-label">{$t('authManagement.alternative', { values: { count: chainIndex + 1 } })}</span>
          <ol class="steps">
            {#each chain as step, stepIndex}
              <li class="step">
                {#if stepIndex > 0}<svg class="arrow" viewBox="0 0 32 20" aria-hidden="true"><path d="M1 10H28M22 4L28 10L22 16" /></svg>{/if}
                <button type="button" class="node" class:selected={selectedChain === chainIndex && selectedStep === stepIndex} aria-pressed={selectedChain === chainIndex && selectedStep === stepIndex} aria-label={`${$t('authManagement.selectedStep', { values: { alternative: chainIndex + 1, step: stepIndex + 1 } })}: ${authMethodName(step.method, $t)}`} onclick={() => onSelect(chainIndex, stepIndex)}>
                  <span class="node-title"><span class="step-number">{stepIndex + 1}</span>{authMethodName(step.method, $t)}</span>
                  {#if step.method !== 'password'}<span class="node-copy">{summary(step)}</span>{/if}
                  {#if step.method === 'publickey' && step.credential_ids.length > 1}<span class="node-hint">{$t('authManagement.candidateKeys')}</span>{/if}
                </button>
              </li>
            {/each}
          </ol>
          {#if !canCompleteChain(chain, credentials)}<p class="path-warning">{$t('authManagement.unavailablePath')}</p>{/if}
        </li>
      {/each}
    </ol>
    <div class="terminal terminal-end"><Icon name="verified" size="17px" /><span>{$t('authManagement.finish')}</span></div>
    </div>
  {:else}<div class="graph-empty"><Icon name={purpose === 'login' ? 'warningAmber' : 'verifiedUser'} size="28px" /><p>{$t(`authManagement.empty.${purpose}`)}</p></div>{/if}
</div>

<style>
  .flow-graph { container: authentication-graph / inline-size; min-width: 0; padding: 1.25rem .75rem; background: var(--explorer-surface); border-radius: 12px; }
  .graph-network { display: grid; grid-template-columns: 48px minmax(0, 1fr) 48px; align-items: center; }
  .terminal { position: relative; display: grid; justify-items: center; align-content: center; gap: 8px; padding: .4rem; font-size: 12px; font-weight: 600; text-align: center; overflow-wrap: anywhere; }
  .terminal-start::after, .terminal-end::before { content: ''; position: absolute; width: .5rem; height: 1px; background: var(--explorer-border-strong); top: 50%; }
  .terminal-start::after { right: 0; } .terminal-end::before { left: 0; }
  .graph-caption { text-align: center; color: var(--explorer-text-muted); font-size: 12px; padding: .5rem 0 1rem; }
  ol { list-style: none; margin: 0; padding: 0; }
  .branches { position: relative; display: grid; gap: 16px; padding: .5rem .875rem; border-inline: 1px solid var(--explorer-border-strong); }
  .branch { position: relative; padding: .875rem; border: 1px solid var(--explorer-border); border-radius: 8px; }
  .branch::before, .branch::after { content: ''; position: absolute; height: 1px; width: .875rem; background: var(--explorer-border-strong); top: 50%; }
  .branch::before { left: -.875rem; } .branch::after { right: -.875rem; }
  .branch-label { display: block; font-size: 12px; color: var(--explorer-text-muted); margin-bottom: .65rem; }
  .steps { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .step { display: flex; align-items: center; min-width: 0; flex: 1 1 10rem; }
  .arrow { width: 32px; flex: none; margin-right: .5rem; fill: none; stroke: var(--explorer-text-muted); stroke-width: 1.5; }
  .node { display: grid; gap: 8px; min-width: 0; width: 100%; padding: .875rem; border: 1px solid var(--explorer-border-strong); border-radius: 8px; background: var(--explorer-surface-raised); text-align: left; color: var(--explorer-text); cursor: pointer; transition: background 160ms ease-out, border-color 160ms ease-out; }
  .node:hover { background: var(--explorer-surface-hover); }
  .node.selected { border-color: var(--explorer-accent); background: color-mix(in srgb, var(--explorer-accent) 9%, var(--explorer-surface-raised)); }
  .node-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
  .step-number { display: grid; place-items: center; width: 1.25rem; height: 1.25rem; border-radius: 50%; background: var(--explorer-surface-hover); font-size: 12px; }
  .node-copy, .node-hint { font-size: 12px; color: var(--explorer-text-muted); overflow-wrap: anywhere; }
  .path-warning { font-size: 12px; color: var(--explorer-warning); margin: .65rem 0 0; }
  .graph-empty { display: grid; justify-items: center; gap: 12px; padding: 2rem 1rem; text-align: center; color: var(--explorer-text-muted); font-size: 14px; }
  @container authentication-graph (max-width: 600px) { .steps { flex-direction: column; align-items: stretch; } .step { flex: auto; flex-direction: column; } .arrow { transform: rotate(90deg); margin: .2rem 0 .5rem; } .branch { padding: .65rem; } .node { padding: .65rem; } }
  @container authentication-graph (max-width: 380px) {
    .graph-network { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .terminal { display: flex; font-size: 12px; padding: .5rem 0; }
    .terminal-end { justify-content: flex-end; }
    .terminal-start::after { left: 0; right: auto; top: 100%; width: 1px; height: .5rem; }
    .terminal-end::before { right: 0; left: auto; top: -.5rem; width: 1px; height: .5rem; }
    .branches { padding-inline: .6rem; }
    .branch::before, .branch::after { width: .6rem; }
    .branch::before { left: -.6rem; } .branch::after { right: -.6rem; }
  }
  @media (prefers-reduced-motion: reduce) { .node { transition: none; } }
</style>
