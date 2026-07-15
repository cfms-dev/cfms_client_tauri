import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectSourceFacts,
  extractFluentCatalogKeys,
  extractTypeScriptCatalogKeys,
  isTranslationKeyUsed,
} from './check-unused-i18n.mjs';

test('extracts leaf keys from a TypeScript translation object', () => {
  const keys = extractTypeScriptCatalogKeys(`
    export const en = {
      common: { save: 'Save', cancel: 'Cancel' },
      title: 'Title',
    } as const;
  `, 'en');

  assert.deepEqual([...keys].sort(), ['common.cancel', 'common.save', 'title']);
});

test('extracts Fluent message and term identifiers', () => {
  const keys = extractFluentCatalogKeys(`
message = Message
-brand = Brand
  .attribute = ignored
`);

  assert.deepEqual([...keys].sort(), ['-brand', 'message']);
});

test('recognizes exact and resolvable template-literal usages', () => {
  const facts = collectSourceFacts([
    `translate('common.save'); const channels = ['stable', 'beta'];`,
    'translate(`settings.updates.${channel}Description`);',
  ]);

  assert.equal(isTranslationKeyUsed('common.save', facts), true);
  assert.equal(isTranslationKeyUsed('common.cancel', facts), false);
  assert.equal(isTranslationKeyUsed('settings.updates.stableDescription', facts), true);
  assert.equal(isTranslationKeyUsed('settings.updates.alphaDescription', facts), false);
});
