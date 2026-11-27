import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findFocusStyleViolations,
  validateAuthoritativeFocusStyles,
} from './check-focus-ring-contract.mjs';

test('rejects Tailwind focus paint on an ordinary native field', () => {
  const violations = findFocusStyleViolations(`
    <input class="border focus:border-transparent focus:ring-2" />
  `);

  assert.equal(violations.length, 1);
  assert.match(violations[0].reason, /focus:ring-2/);
});

test('allows an explicitly delegated composite field to own its focus paint', () => {
  const violations = findFocusStyleViolations(`
    <input data-focus-ring="delegated" class="focus:ring-2" />
    <style>
      .field:focus-within { border-color: blue; box-shadow: inset 0 0 0 1px blue; }
    </style>
  `);

  assert.deepEqual(violations, []);
});

test('rejects component CSS that paints a native field focus ring', () => {
  const violations = findFocusStyleViolations(`
    <style>
      input:focus, select:focus { outline: 2px solid blue; }
    </style>
  `);

  assert.equal(violations.length, 1);
  assert.match(violations[0].reason, /input:focus, select:focus/);
});

test('allows a delegated input to reveal focus on a sibling proxy', () => {
  const violations = findFocusStyleViolations(`
    <input type="checkbox" data-focus-ring="delegated" />
    <style>
      input:focus-visible + .checkbox { box-shadow: 0 0 0 2px blue; }
    </style>
  `);

  assert.deepEqual(violations, []);
});

test('requires the global focus renderer to remain authoritative', () => {
  const problems = validateAuthoritativeFocusStyles(`
    :root :where(input, textarea, select):not([data-focus-ring="delegated"]):focus {
      border-color: blue !important;
      outline: none !important;
      box-shadow: inset 0 0 0 1px blue !important;
    }
    :root :where([data-focus-ring="delegated"]):focus {
      outline: none !important;
    }
  `);

  assert.deepEqual(problems, []);
});

test('accepts Prettier-formatted single quotes in the authoritative focus rules', () => {
  const problems = validateAuthoritativeFocusStyles(`
    :root :where(input, textarea, select):not([data-focus-ring='delegated']):focus {
      border-color: blue !important;
      outline: none !important;
      box-shadow: inset 0 0 0 1px blue !important;
    }
    :root :where([data-focus-ring='delegated']):focus {
      outline: none !important;
    }
  `);

  assert.deepEqual(problems, []);
});
