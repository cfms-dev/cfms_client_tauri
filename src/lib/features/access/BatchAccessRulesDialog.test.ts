// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import { tick } from 'svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BatchAccessRulesDialog from '$lib/features/access/BatchAccessRulesDialog.svelte';
import { getAccessRules, listDirectoryPage, setAccessRules } from '$lib/api';
import { dialogStore, type ChoiceDialogOptions, type ChoiceDialogResult } from '$lib/shared/ui/dialogs.svelte.ts';
import { floatingProgressStore } from "$lib/shared/notifications/progress.svelte.ts";
import type { BatchRulesProblem, BatchRulesTarget } from '$lib/features/access/batch-access-rules';
import type { AccessRulesRecord } from '$lib/features/access/access-rules';
import { en } from '$lib/shared/i18n/messages/en';
import { zh_CN as zhCN } from '$lib/shared/i18n/messages/zh-CN';
import '$lib/shared/i18n';

vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  getAccessRules: vi.fn(), listDirectoryPage: vi.fn(), setAccessRules: vi.fn(),
  getLocale: vi.fn(), setLocale: vi.fn(),
}));
vi.mock('$lib/shared/ui/dialogs.svelte.ts', () => ({ dialogStore: { choose: vi.fn() } }));
vi.mock('$lib/shared/platform/platform', () => ({ isMobilePlatform: () => false }));
vi.mock('$lib/shared/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));

const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: () => {
    const animation = { cancel: vi.fn(), currentTime: 0, effect: {}, finished: Promise.resolve(),
      onfinish: null as (() => void) | null, playState: 'finished' };
    queueMicrotask(() => animation.onfinish?.());
    return animation;
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const targets: BatchRulesTarget[] = [
  { objectType: 'directory', objectId: 'folder', name: 'Documents', path: '/Documents' },
  { objectType: 'document', objectId: 'document', name: 'Report.txt', path: '/Report.txt' },
];
const templateRules = { read: [{ match: 'any' as const, match_groups: [] }] };
const recursiveLabel = 'Also apply these rules to subfolders and documents';
const inheritLabel = 'Inherit rules from parent object';
const scopeTitle = 'Confirm access rule changes';
const emptyPage = { folders: [], documents: [], parent_id: null, has_more: false, next_cursor: null, page_size: 128 };
type Props = { targets: BatchRulesTarget[]; initialTemplateKey?: string; canReadTemplate: boolean;
  checkGuard: () => BatchRulesProblem | null; onApplied: () => Promise<void>; onClose: () => void };
function setup(options: Partial<Props> = {}) {
  const onApplied = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const props: Props = { targets, canReadTemplate: true, checkGuard: () => null, onApplied, onClose, ...options };
  const view = render(BatchAccessRulesDialog, props);
  return { ...view, onApplied, onClose, props };
}
function submittedRules(index: number): AccessRulesRecord {
  return vi.mocked(setAccessRules).mock.calls[index][2] as AccessRulesRecord;
}
async function initialized(name?: string) {
  if (name) await screen.findByText('Shared rule template from: ' + name);
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'OK' }).disabled).toBe(false));
}
async function confirmScope(count = 2) {
  const modal = await screen.findByRole('dialog', { name: scopeTitle });
  await fireEvent.click(within(modal).getByRole('button', { name: `Apply to ${count} objects` }));
}
async function source(text: string) {
  await fireEvent.click(screen.getByRole('button', { name: 'Source Code' }));
  const content = await screen.findByLabelText('Access rules');
  const editor = EditorView.findFromDOM(content)!;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  await tick();
  return editor;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(floatingProgressStore, 'remove');
  locale.set('en');
  document.documentElement.dataset.reduceMotion = 'true';
  document.documentElement.dataset.theme = 'light';
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true,
    value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }) });
  vi.mocked(getAccessRules).mockResolvedValue({ rules: templateRules, inherit: false });
  vi.mocked(setAccessRules).mockResolvedValue(true);
  vi.mocked(listDirectoryPage).mockResolvedValue(emptyPage);
  vi.mocked(dialogStore.choose).mockResolvedValue({ value: 'skip', applyToAll: false });
});
afterEach(() => {
  cleanup();
  floatingProgressStore.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete document.documentElement.dataset.reduceMotion;
  if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

describe('BatchAccessRulesDialog property-style editing', () => {
  it.each([
    { language: 'en', messages: en, target: targets[0] },
    { language: 'en', messages: en, target: targets[1] },
    { language: 'zh-CN', messages: zhCN, target: targets[0] },
    { language: 'zh-CN', messages: zhCN, target: targets[1] },
  ])('hides batch template controls for a single $target.objectType in $language', async ({ language, messages, target }) => {
    locale.set(language);
    setup({ targets: [target] });
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: messages.files.batchRules.ok }).disabled).toBe(false));
    expect(getAccessRules).toHaveBeenCalledExactlyOnceWith(target.objectType, target.objectId);
    expect(screen.queryByRole('combobox', { name: messages.files.batchRules.templateObject })).toBeNull();
    expect(screen.queryByRole('button', { name: messages.files.batchRules.loadTemplate })).toBeNull();
    expect(screen.queryByText(messages.files.batchRules.templateSource.replace('{name}', target.name))).toBeNull();
    expect(screen.queryByText(messages.files.batchRules.overwrite)).toBeNull();
    expect(screen.queryByText(messages.files.batchRules.newDraft)).toBeNull();
    expect(!!screen.queryByRole('checkbox', { name: messages.files.batchRules.recursive })).toBe(target.objectType === 'directory');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: messages.files.batchRules.applyChanges }).disabled).toBe(true);
  });

  it.each([
    { language: 'en', messages: en },
    { language: 'zh-CN', messages: zhCN },
  ])('keeps batch template controls for multiple objects in $language', async ({ language, messages }) => {
    locale.set(language);
    setup();
    await screen.findByText(messages.files.batchRules.templateSource.replace('{name}', targets[0].name));
    expect(screen.getByRole('combobox', { name: messages.files.batchRules.templateObject })).toBeTruthy();
    expect(screen.getByRole('button', { name: messages.files.batchRules.loadTemplate })).toBeTruthy();
    expect(screen.getByText(messages.files.batchRules.overwrite)).toBeTruthy();
  });

  it('shows a generic loading state for a single object and blocks submission until its rules arrive', async () => {
    const response = deferred<{ rules: unknown; inherit: boolean }>();
    vi.mocked(getAccessRules).mockReturnValueOnce(response.promise);
    setup({ targets: [targets[1]] });
    expect(await screen.findByRole('status', { name: en.common.loadingEllipsis })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load as template' })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'OK' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
    response.resolve({ rules: templateRules, inherit: false });
    await initialized();
    expect(screen.queryByRole('status', { name: en.common.loadingEllipsis })).toBeNull();
    expect(screen.getByRole('switch', { name: inheritLabel }).getAttribute('aria-checked')).toBe('false');
  });

  it('retries a failed single-object read without showing template controls', async () => {
    vi.mocked(getAccessRules).mockRejectedValueOnce('Server returned 403: denied');
    setup({ targets: [targets[1]] });
    await screen.findByText('Server returned 403: denied');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Create empty rules' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await initialized();
    expect(getAccessRules).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Server returned 403: denied')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load as template' })).toBeNull();
  });

  it.each([true, false])('allows a single-object draft without current rules (read permission: %s)', async (canReadTemplate) => {
    vi.mocked(getAccessRules).mockRejectedValueOnce('Server returned 403: denied');
    setup({ targets: [targets[1]], canReadTemplate });
    if (canReadTemplate) {
      await screen.findByText('Server returned 403: denied');
      await fireEvent.click(screen.getByRole('button', { name: 'Create empty rules' }));
    }
    await screen.findByText('New rule draft; current rules have not been read');
    await initialized();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Load as template' })).toBeNull();
    expect(screen.queryByText(en.files.batchRules.overwrite)).toBeNull();
    expect(getAccessRules).toHaveBeenCalledTimes(canReadTemplate ? 1 : 0);
    await fireEvent.click(screen.getByRole('button', { name: 'Add Rule Group' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Applied to 1 objects');
    expect(setAccessRules).toHaveBeenCalledExactlyOnceWith('document', 'document', expect.any(Object), true);
  });

  it('applies changes to a single object and restores its clean baseline', async () => {
    setup({ targets: [targets[1]] });
    await initialized();
    await fireEvent.click(screen.getByRole('switch', { name: inheritLabel }));
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(false));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Applied to 1 objects');
    expect(setAccessRules).toHaveBeenCalledExactlyOnceWith('document', 'document', expect.objectContaining(templateRules), true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Load as template' })).toBeNull();
  });

  it.each([
    ['en', 'Set permissions'],
    ['zh-CN', '设置权限'],
  ])('uses the regular permissions label for a selection in %s', async (language, title) => {
    locale.set(language);
    setup({ initialTemplateKey: 'document:document' });
    expect(await screen.findByRole('dialog', { name: title })).toBeTruthy();
    await waitFor(() => expect(getAccessRules).toHaveBeenCalledExactlyOnceWith('document', 'document'));
  });

  it('automatically reads the selected focus object and places OK, Cancel, Apply in Windows order', async () => {
    setup({ initialTemplateKey: 'document:document' });
    await initialized('Report.txt');
    expect(getAccessRules).toHaveBeenCalledExactlyOnceWith('document', 'document');
    expect(screen.getByRole('switch', { name: inheritLabel }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('checkbox', { name: recursiveLabel }).getAttribute('aria-checked')).toBe('false');
    const ok = screen.getByRole('button', { name: 'OK' });
    expect(Array.from(ok.parentElement!.children).map((element) => element.textContent?.trim())).toEqual(['OK', 'Cancel', 'Apply']);
    expect(ok.hasAttribute('data-dialog-default')).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(false);
  });

  it('falls back to the first selected template when the focus key is outside the selection', async () => {
    setup({ initialTemplateKey: 'directory:outside' });
    await initialized();
    expect(getAccessRules).toHaveBeenCalledExactlyOnceWith('directory', 'folder');
  });

  it('opens an editable new draft without read permission and confirms an empty-rule clear', async () => {
    setup({ canReadTemplate: false });
    expect(await screen.findByText('New rule draft; current rules have not been read')).toBeTruthy();
    expect(screen.getByRole('switch', { name: inheritLabel }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Load as template' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByRole('dialog', { name: scopeTitle });
    expect(screen.getByText(/rules are empty/)).toBeTruthy();
    expect(getAccessRules).not.toHaveBeenCalled();
    expect(listDirectoryPage).not.toHaveBeenCalled();
    expect(setAccessRules).not.toHaveBeenCalled();
    await confirmScope();
    await screen.findByText('Applied to 2 objects');
    expect(setAccessRules).toHaveBeenCalledTimes(2);
    expect(vi.mocked(setAccessRules).mock.calls.every((call) => call[3] === true)).toBe(true);
  });

  it('closes an unchanged single folder with OK without writing and keeps Apply disabled', async () => {
    const { onClose } = setup({ targets: [targets[0]] });
    await initialized();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(setAccessRules).not.toHaveBeenCalled();
  });

  it.each(['OK', 'Apply'])('%s applies a multi-object template and waits for refresh before completing', async (action) => {
    const refresh = deferred<void>();
    const view = setup();
    view.onApplied.mockReturnValue(refresh.promise);
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(view.onApplied).toHaveBeenCalledOnce());
    expect(view.onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Refreshing the directory…')).toBeTruthy();
    expect(view.baseElement.querySelector('.batch-rules-editor')).not.toBeNull();
    refresh.resolve();
    if (action === 'OK') await waitFor(() => expect(view.onClose).toHaveBeenCalledOnce());
    else {
      await screen.findByText('Applied to 2 objects');
      expect(view.onClose).not.toHaveBeenCalled();
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
      expect(screen.getByRole('switch', { name: inheritLabel }).getAttribute('aria-checked')).toBe('false');
    }
    expect(setAccessRules).toHaveBeenCalledTimes(2);
  });

  it('establishes a new baseline after Apply and allows only actual rule or inheritance changes to apply again', async () => {
    setup();
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Applied to 2 objects');
    const apply = screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' });
    expect(apply.disabled).toBe(true);
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('switch', { name: inheritLabel }).disabled).toBe(false));
    await fireEvent.click(screen.getByRole('switch', { name: inheritLabel }));
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(false));
    await fireEvent.click(screen.getByRole('switch', { name: inheritLabel }));
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true));
    await fireEvent.click(screen.getByRole('button', { name: 'Add Rule Group' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Applied to 2 objects');
    expect(setAccessRules).toHaveBeenCalledTimes(4);
    expect(submittedRules(2).read).toHaveLength(2);
  });

  it('blocks initial submission until the template arrives', async () => {
    const template = deferred<{ rules: unknown; inherit: boolean }>();
    vi.mocked(getAccessRules).mockReturnValueOnce(template.promise);
    setup();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'OK' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
    template.resolve({ rules: templateRules, inherit: false });
    await initialized();
  });

  it('offers retry or an empty editable draft when the initial read fails', async () => {
    vi.mocked(getAccessRules).mockRejectedValueOnce('Server returned 403: denied');
    setup();
    await screen.findByText('Server returned 403: denied');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Create empty rules' }));
    expect(screen.getByText('New rule draft; current rules have not been read')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Add Rule Group' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Load as template' }));
    await initialized();
    expect(getAccessRules).toHaveBeenCalledTimes(2);
  });

  it('ignores a template reload arriving after the user changes the draft', async () => {
    setup();
    await initialized();
    const template = deferred<{ rules: unknown; inherit: boolean }>();
    vi.mocked(getAccessRules).mockReturnValueOnce(template.promise);
    await fireEvent.change(screen.getByRole('combobox', { name: 'Rule template source' }), { target: { value: 'document:document' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Load as template' }));
    await fireEvent.click(screen.getByRole('switch', { name: inheritLabel }));
    template.resolve({ rules: {}, inherit: false });
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(false));
    expect(screen.getByRole('switch', { name: inheritLabel }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Shared rule template from: Documents')).toBeTruthy();
  });

  it('explicitly reloading identical original rules replaces the unsaved draft', async () => {
    setup();
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: 'Add Rule Group' }));
    await fireEvent.click(screen.getByRole('switch', { name: inheritLabel }));
    await fireEvent.click(screen.getByRole('button', { name: 'Load as template' }));
    await waitFor(() => expect(getAccessRules).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('switch', { name: inheritLabel }).getAttribute('aria-checked')).toBe('false'));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Applied to 2 objects');
    expect(submittedRules(0).read).toEqual(templateRules.read);
  });

  it('preserves source text when Escape cancels recursive scope confirmation and writes nothing', async () => {
    const { onClose } = setup({ canReadTemplate: false });
    const text = '{"read":[{"match":"all","match_groups":[]}]}';
    const editor = await source(text);
    await fireEvent.click(screen.getByRole('checkbox', { name: recursiveLabel }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const modal = await screen.findByRole('dialog', { name: scopeTitle });
    await fireEvent.keyDown(modal, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: scopeTitle })).toBeNull());
    expect(editor.state.doc.toString()).toBe(text);
    expect(screen.getByLabelText('Access rules')).toBe(editor.contentDOM);
    expect(setAccessRules).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables submission for invalid source without scanning or writing', async () => {
    setup({ canReadTemplate: false });
    await source('[]');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'OK' }).disabled).toBe(true);
    expect(listDirectoryPage).not.toHaveBeenCalled();
    expect(setAccessRules).not.toHaveBeenCalled();
  });

  it('recursively applies a single folder to child objects first and clears recursion after a full success', async () => {
    vi.mocked(listDirectoryPage).mockResolvedValueOnce({ ...emptyPage,
      documents: [{ id: 'child', title: 'Child.txt' }] as never[] });
    setup({ targets: [targets[0]] });
    await initialized();
    await fireEvent.click(screen.getByRole('checkbox', { name: recursiveLabel }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const modal = await screen.findByRole('dialog', { name: scopeTitle });
    expect(within(modal).getByText('Includes all discovered descendants')).toBeTruthy();
    expect(setAccessRules).not.toHaveBeenCalled();
    await confirmScope();
    await screen.findByText('Applied to 2 objects');
    expect(vi.mocked(setAccessRules).mock.calls.map(([, id]) => id)).toEqual(['child', 'folder']);
    expect(screen.getByRole('checkbox', { name: recursiveLabel }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
  });

  it('requires incomplete-scope acknowledgement and preserves partial coverage in the results', async () => {
    vi.mocked(listDirectoryPage).mockRejectedValueOnce('Server returned 403: denied');
    setup({ canReadTemplate: false });
    await fireEvent.click(screen.getByRole('checkbox', { name: recursiveLabel }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const modal = await screen.findByRole('dialog', { name: scopeTitle });
    const apply = within(modal).getByRole<HTMLButtonElement>('button', { name: 'Apply to 2 objects' });
    expect(apply.disabled).toBe(true);
    expect(within(modal).getByRole('button', { name: 'Scan scope again' })).toBeTruthy();
    await fireEvent.click(within(modal).getByRole('checkbox', { name: /scope is incomplete/ }));
    await fireEvent.click(apply);
    await screen.findByText('This run has finished');
    expect(screen.getByText(/number of undiscovered objects is unknown/)).toBeTruthy();
    expect(screen.queryByText('Applied to 2 objects')).toBeNull();
    expect(setAccessRules).toHaveBeenCalledTimes(2);
  });

  it('enumerates descendants again for each new recursive Apply round', async () => {
    vi.mocked(listDirectoryPage)
      .mockResolvedValueOnce({ ...emptyPage, documents: [{ id: 'old-child', title: 'Old.txt' }] as never[] })
      .mockResolvedValueOnce({ ...emptyPage, documents: [{ id: 'new-child', title: 'New.txt' }] as never[] });
    setup({ targets: [targets[0]] });
    await initialized();
    await fireEvent.click(screen.getByRole('checkbox', { name: recursiveLabel }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await confirmScope();
    await screen.findByText('Applied to 2 objects');
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('switch', { name: inheritLabel }).disabled).toBe(false));
    await fireEvent.click(screen.getByRole('checkbox', { name: recursiveLabel }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await confirmScope();
    await screen.findByText('Applied to 2 objects');
    expect(listDirectoryPage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(setAccessRules).mock.calls.map(([, id]) => id)).toEqual(['old-child', 'folder', 'new-child', 'folder']);
  });

  it('rescans an incomplete recursive scope without sending writes before confirmation', async () => {
    vi.mocked(listDirectoryPage).mockRejectedValueOnce('Server returned 403: denied');
    setup({ canReadTemplate: false });
    await fireEvent.click(screen.getByRole('checkbox', { name: recursiveLabel }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const modal = await screen.findByRole('dialog', { name: scopeTitle });
    await fireEvent.click(within(modal).getByRole('button', { name: 'Scan scope again' }));
    const retried = await screen.findByRole('dialog', { name: scopeTitle });
    expect(listDirectoryPage).toHaveBeenCalledTimes(2);
    expect(within(retried).queryByRole('checkbox', { name: /scope is incomplete/ })).toBeNull();
    expect(setAccessRules).not.toHaveBeenCalled();
    await confirmScope();
    await screen.findByText('Applied to 2 objects');
  });

  it('passes per-object failure choices and retries skipped failures without writing successes again', async () => {
    vi.mocked(setAccessRules).mockRejectedValueOnce('Server returned 403: denied');
    const { onApplied } = setup();
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('This run has finished');
    expect(dialogStore.choose).toHaveBeenCalledOnce();
    const choice = vi.mocked(dialogStore.choose).mock.calls[0][0];
    expect(choice.title).toBe('Unable to apply access rules');
    expect(choice.choices.map((item) => item.value)).toEqual(['retry', 'skip', 'skip_all']);
    expect(choice.details?.[0]).toMatchObject({ label: 'Documents', meta: '/Documents' });
    expect(choice.cancelLabel).toBe('Stop further processing');
    expect(choice.signal).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    await fireEvent.change(screen.getByRole('combobox', { name: 'Show results' }), { target: { value: 'failed' } });
    expect(screen.getByText('Skipped')).toBeTruthy();
    expect(screen.getByText('Documents')).toBeTruthy();
    expect(screen.queryByText('Report.txt')).toBeNull();
    await fireEvent.click(await screen.findByRole('button', { name: 'Retry failed objects' }));
    await screen.findByText('Applied to 2 objects');
    expect(onApplied).toHaveBeenCalledTimes(2);
    expect(vi.mocked(setAccessRules).mock.calls.map(([, id]) => id)).toEqual(['folder', 'document', 'folder']);
  });

  it('retries the current failed object before advancing and does not double-count progress', async () => {
    vi.mocked(setAccessRules).mockRejectedValueOnce('Server returned 404: missing');
    vi.mocked(dialogStore.choose).mockResolvedValueOnce({ value: 'retry', applyToAll: false });
    setup();
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Applied to 2 objects');
    expect(vi.mocked(setAccessRules).mock.calls.map(([, id]) => id)).toEqual(['folder', 'folder', 'document']);
  });

  it('skips subsequent errors of the same kind only during that execution', async () => {
    vi.mocked(setAccessRules).mockRejectedValueOnce('Server returned 403: denied').mockRejectedValueOnce('Server returned 403: denied');
    vi.mocked(dialogStore.choose).mockResolvedValueOnce({ value: 'skip_all', applyToAll: false });
    setup();
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('This run has finished');
    expect(screen.getAllByText('Skipped')).toHaveLength(2);
    expect(dialogStore.choose).toHaveBeenCalledOnce();
    vi.mocked(setAccessRules).mockRejectedValueOnce('Server returned 403: denied');
    await fireEvent.click(await screen.findByRole('button', { name: 'Retry failed objects' }));
    await screen.findByText('This run has finished');
    await waitFor(() => expect(dialogStore.choose).toHaveBeenCalledTimes(2));
  });

  it('cancels a pending failure decision when the guard changes and prevents continuation', async () => {
    let choiceOptions!: ChoiceDialogOptions;
    vi.mocked(dialogStore.choose).mockImplementation((options) => {
      choiceOptions = options;
      return new Promise<ChoiceDialogResult | null>((resolve) => options.signal?.addEventListener('abort', () => resolve(null), { once: true }));
    });
    vi.mocked(setAccessRules).mockRejectedValueOnce('Server returned 403: denied');
    const view = setup();
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(dialogStore.choose).toHaveBeenCalledOnce());
    await view.rerender({ ...view.props, checkGuard: () => ({ kind: 'permission' }) });
    await screen.findByText('Batch stopped');
    expect(choiceOptions.signal?.aborted).toBe(true);
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Continue unfinished objects' })).disabled).toBe(true);
    expect(setAccessRules).toHaveBeenCalledOnce();
  });

  it('Escape stops after the in-flight request settles and retains its actual success', async () => {
    const pending = deferred<boolean>();
    vi.mocked(setAccessRules).mockReturnValueOnce(pending.promise);
    const { onClose, onApplied } = setup();
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(setAccessRules).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await screen.findByText('Stopping; waiting for the current request…');
    expect(onClose).not.toHaveBeenCalled();
    pending.resolve(true);
    await screen.findByText('Batch stopped');
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(setAccessRules).toHaveBeenCalledOnce();
    expect(screen.getByText(/Succeeded 1/)).toBeTruthy();
    expect(floatingProgressStore.remove).toHaveBeenCalled();
    await screen.findByRole('button', { name: 'Back to editing' });
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('retains an in-flight success when write permission changes and blocks all recovery actions', async () => {
    const pending = deferred<boolean>();
    vi.mocked(setAccessRules).mockReturnValueOnce(pending.promise);
    const view = setup();
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(setAccessRules).toHaveBeenCalledOnce());
    await view.rerender({ ...view.props, checkGuard: () => ({ kind: 'permission' }) });
    await screen.findByText('Stopping; waiting for the current request…');
    pending.resolve(true);
    await screen.findByText('Batch stopped');
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Continue unfinished objects' })).disabled).toBe(true);
    expect(screen.getByText(/Succeeded 1/)).toBeTruthy();
    expect(setAccessRules).toHaveBeenCalledOnce();
    expect(view.onClose).not.toHaveBeenCalled();
  });

  it('keeps OK results visible after refresh failure and closes only after refresh succeeds', async () => {
    const view = setup();
    view.onApplied.mockRejectedValueOnce(new Error('refresh unavailable'));
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await screen.findByText(/Directory refresh failed; recorded update results remain valid/);
    expect(view.onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Succeeded 2/)).toBeTruthy();
    await fireEvent.click(await screen.findByRole('button', { name: 'Retry directory refresh' }));
    await waitFor(() => expect(view.onClose).toHaveBeenCalledOnce());
    expect(setAccessRules).toHaveBeenCalledTimes(2);
    expect(view.onApplied).toHaveBeenCalledTimes(2);
  });

  it('uses an auxiliary confirmation for uncertain resubmission and cancellation sends no new write', async () => {
    vi.mocked(setAccessRules).mockRejectedValueOnce(new Error('Connection failed: no response'));
    setup();
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Batch stopped');
    await fireEvent.click(await screen.findByRole('button', { name: 'Resubmit unconfirmed objects' }));
    const modal = await screen.findByRole('dialog', { name: 'Resubmit objects with unconfirmed results' });
    await fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));
    expect(setAccessRules).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: 'Resubmit unconfirmed objects' }));
    const second = await screen.findByRole('dialog', { name: 'Resubmit objects with unconfirmed results' });
    await fireEvent.click(within(second).getByRole('button', { name: 'Resubmit unconfirmed objects' }));
    await screen.findByText('This run has finished');
    expect(vi.mocked(setAccessRules).mock.calls.map(([, id]) => id)).toEqual(['folder', 'folder']);
    expect(screen.getByText(/Succeeded 1/)).toBeTruthy();
  });

  it('freezes fresh-round rules, removes old recovery actions, and reconfirms historical uncertain targets', async () => {
    vi.mocked(setAccessRules).mockRejectedValueOnce(new Error('Connection failed: no response'));
    setup();
    await initialized();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Batch stopped');
    await fireEvent.click(await screen.findByRole('button', { name: 'Back to editing' }));
    expect(screen.queryByRole('button', { name: 'Resubmit unconfirmed objects' })).toBeNull();
    await source('{"write":[{"match":"all","match_groups":[]}]}');
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByRole('dialog', { name: scopeTitle });
    expect(screen.getByText(/may have been updated without a confirmed response/)).toBeTruthy();
    expect(setAccessRules).toHaveBeenCalledOnce();
    await confirmScope();
    await screen.findByText('Applied to 2 objects');
    const calls = vi.mocked(setAccessRules).mock.calls;
    expect(submittedRules(0).read).toEqual(templateRules.read);
    expect(submittedRules(1).read).toEqual([]);
    expect(submittedRules(1).write).toEqual([{ match: 'all', match_groups: [] }]);
    expect(calls[2][2]).toEqual(calls[1][2]);
  });

  it('preserves a server cooldown when returning to editing and starting a new round', async () => {
    setup();
    await initialized();
    vi.useFakeTimers();
    vi.mocked(setAccessRules).mockRejectedValueOnce('Server returned 429: slow down\nCFMS_ERROR_DATA:{"retry_after_seconds":30}');
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await vi.waitFor(() => expect(screen.getByText(/Retrying in \d+ seconds/)).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Stop further processing' }));
    await vi.waitFor(() => expect(screen.getByText('Batch stopped')).toBeTruthy());
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Back to editing' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Back to editing' }));
    await fireEvent.click(screen.getByRole('switch', { name: inheritLabel }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await vi.waitFor(() => expect(screen.getByText(/Retrying in \d+ seconds/)).toBeTruthy());
    expect(setAccessRules).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(screen.getByText('Applied to 2 objects')).toBeTruthy());
    expect(setAccessRules).toHaveBeenCalledTimes(3);
    expect(vi.mocked(setAccessRules).mock.calls[1][3]).toBe(true);
  });
});
