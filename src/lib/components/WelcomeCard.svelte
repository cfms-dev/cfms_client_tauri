<script lang="ts">
  // Welcome info card for the Home overview page.
  //
  // Reference: HomeView / WelcomeInfoCard in reference/src/include/ui/components/homepage.py

  import Icon from './Icon.svelte';
</script>

<div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
            border border-md3-outline p-5 flex items-start gap-4">
  <span class="text-md3-primary shrink-0 mt-0.5">
    <Icon name="guardian" size="40px" />
  </span>
  <div>
    <h1
      class="text-lg font-bold text-md3-on-surface"
      style="font-family: var(--font-md3-sans);"
    >
      Welcome to Confidential Document Management System (CFMS)
    </h1>
    <p class="text-sm text-md3-on-surface-variant mt-1.5 leading-relaxed">
      Securely manage, transfer, and track your documents with end-to-end
      encryption. All cryptographic operations are performed locally using
      AES-256-GCM and PBKDF2-HMAC-SHA256.
    </p>
  </div>
</div>
