import assert from 'node:assert/strict';
import test from 'node:test';
import { frontendViolations, rustDependencyViolations, ipcViolations, moduleReferences } from './check-architecture.mjs';

test('finds alias, re-export, type import, lazy module and Worker dependencies in Svelte', () => {
  const source = `<script lang="ts">
    import type { Task } from '$lib/api/types/transfers';
    export { command } from './commands';
    const loader = () => import('./details.svelte');
    const worker = new Worker(new URL('./sort.worker.ts', import.meta.url));
    type Lazy = typeof import('./types');
  </script><p>import('not-a-module')</p>`;
  assert.deepEqual(moduleReferences(source, 'fixture.svelte').map((ref) => ref.specifier), [
    '$lib/api/types/transfers', './commands', './details.svelte', './sort.worker.ts', './types',
  ]);
});

test('rejects foundation-to-business and business-to-application imports', () => {
  const sources = new Map([
    ['src/lib/shared/control.ts', `import '$lib/features/files/model';`],
    ['src/lib/features/files/model.ts', `import '$lib/app/session';`],
    ['src/lib/app/session.ts', 'export {};'],
  ]);
  const errors = frontendViolations(sources);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /foundation module depends/);
  assert.match(errors[1], /business module depends/);
});

test('detects business cycles even when individual source modules are acyclic', () => {
  const sources = new Map([
    ['src/lib/features/files/list.ts', `import '$lib/features/access/model';`],
    ['src/lib/features/access/model.ts', 'export {};'],
    ['src/lib/features/access/editor.ts', `import '$lib/features/files/types';`],
    ['src/lib/features/files/types.ts', 'export {};'],
  ]);
  assert.match(frontendViolations(sources).join('\n'), /Business dependency cycle/);
});

test('rejects private cross-business imports and native SDK calls outside adapters', () => {
  const sources = new Map([
    ['src/lib/features/files/work.ts', `import '$lib/features/transfers/internal/queue'; import { invoke } from '@tauri-apps/api/core';`],
    ['src/lib/app/Workspace.ts', `import '$lib/features/transfers/internal/queue';`],
    ['src/lib/features/transfers/internal/queue.ts', 'export {};'],
  ]);
  const errors = frontendViolations(sources);
  assert.equal(errors.length, 3);
  assert.match(errors.join('\n'), /private implementation/);
  assert.match(errors.join('\n'), /native SDK access/);
});

test('resolves Worker and raw asset references and checks moved mock paths', () => {
  const sources = new Map([
    ['src/lib/features/files/sort.ts', `new Worker(new URL('./sort.worker.ts', import.meta.url)); import icon from './icon.svg?raw';`],
    ['src/lib/features/files/sort.worker.ts', 'export {};'],
    ['src/lib/features/files/sort.test.ts', `vi.mock('$lib/stores.svelte', () => ({}));`],
  ]);
  const errors = frontendViolations(sources, ['src/lib/features/files/icon.svg']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unresolved local reference \$lib\/stores.svelte/);
});

test('rejects reverse crate dependencies including target-specific and test dependencies', () => {
  const metadata = { packages: [{ name: 'cfms-core', dependencies: [
    { name: 'cfms-service', kind: 'dev' }, { name: 'tauri', target: 'cfg(windows)' },
  ] }] };
  assert.equal(rustDependencyViolations(metadata).length, 2);
});

test('allows leaf libraries and domain imports through public root modules', () => {
  const sources = new Map([
    ['src/lib/app/Workspace.svelte', `<script>import '$lib/features/files/model';</script>`],
    ['src/lib/features/files/model.ts', `import '$lib/features/transfers/queue';`],
    ['src/lib/features/transfers/queue.ts', `import '$lib/shared/platform/native-events';`],
    ['src/lib/shared/platform/native-events.ts', `export { listen } from '@tauri-apps/api/event';`],
  ]);
  assert.deepEqual(frontendViolations(sources), []);
});

test('detects unregistered native commands, stale invoke names and textual module inclusion', () => {
  const frontend = new Map([['src/lib/api/files.ts', `invoke('removed');`]]);
  const native = new Map([
    ['src-tauri/src/commands/registry.rs', 'tauri::generate_handler![super::files::list,]'],
    ['src-tauri/src/commands/files.rs', '#[tauri::command]\npub async fn list() {}\n#[tauri::command]\npub fn forgotten() {}'],
    ['src-tauri/src/commands.rs', 'include!("commands/files.rs");'],
  ]);
  const errors = ipcViolations(frontend, native);
  assert.equal(errors.length, 3);
  assert.match(errors.join('\n'), /Unregistered IPC command: forgotten/);
  assert.match(errors.join('\n'), /unregistered IPC command removed/);
  assert.match(errors.join('\n'), /source inclusion/);
});
