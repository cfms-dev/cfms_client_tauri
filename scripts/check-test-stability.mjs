import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { iterations: { type: 'string', default: '20' } } });
const iterations = Number(values.iterations);
if (!Number.isSafeInteger(iterations) || iterations < 1) throw new Error('--iterations must be a positive integer');

// Each invocation runs exactly one behavior in a fresh process. Repeating an
// entire file can hide the same order dependency as a normal full-suite run.
const cases = [
  ['src/lib/shared/ui/SnackBarHost.dom.test.ts', 'never flashes a task completed before the display delay'],
  ['src/lib/shared/ui/SnackBarHost.dom.test.ts', 'cancels its notification and progress timers on unmount without late updates'],
  ['src/lib/features/files/directory-load-controller.test.ts', 'rejects a page request that never settles instead of leaving the UI loading forever'],
  ['src/lib/app/files/FileWorkspace.dom.test.ts', 'clears the scoped retry notification on navigation and cancels active work on unmount'],
];
const cli = fileURLToPath(new URL('./vitest.mjs', import.meta.resolve('vitest/package.json')));
const root = fileURLToPath(new URL('..', import.meta.url));

for (const [file, name] of cases) {
  const pattern = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  const args = ['run', file, '-t', pattern, '--reporter=json', '--allowOnly=false'];
  console.log(`Reproduce: pnpm exec vitest ${args.map((arg) => JSON.stringify(arg)).join(' ')}`);
  for (let iteration = 1; iteration <= iterations; iteration++) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
    });
    if (result.status !== 0) {
      console.error(`FAIL ${file}: ${name} (iteration ${iteration}/${iterations})`);
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
      if (result.error) console.error(result.error);
      process.exit(result.status ?? 1);
    }
    // Vitest exits successfully when -t matches nothing in an existing file.
    // Treat a renamed/missing scenario as a failure of this validation too.
    if (JSON.parse(result.stdout).numPassedTests !== 1) {
      console.error(`Expected exactly one passing test: ${file}: ${name}`);
      process.stdout.write(result.stdout ?? '');
      process.exit(1);
    }
    console.log(`PASS ${iteration}/${iterations}: ${name}`);
  }
}
