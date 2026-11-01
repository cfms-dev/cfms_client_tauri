// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FileAddressBar from './FileAddressBar.svelte';

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

vi.mock('$lib/motion/transitions', () => ({ menuScale: () => ({ duration: 0 }) }));
vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAddressBar(overrides: Partial<Parameters<typeof render<typeof FileAddressBar>>[1]> = {}) {
  const callbacks = {
    onNavigate: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onBeginEdit: vi.fn(),
  };
  const result = render(FileAddressBar, {
    segments: [{ label: 'Projects', path: 'projects' }],
    lookupEnabled: true,
    knownPath: '/Projects',
    busy: false,
    error: null,
    ...callbacks,
    ...overrides,
  });
  return { ...result, ...callbacks };
}

describe('FileAddressBar', () => {
  it('uses collapsing breadcrumbs without allowing editing when lookup support is disabled', async () => {
    const { component, container, onBeginEdit } = renderAddressBar({ lookupEnabled: false });
    expect(within(screen.getByRole('navigation')).getByText('Projects')).toBeTruthy();
    expect(container.querySelector('.cfms-breadcrumb-container--collapse')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'files.editAddress' })).toBeNull();
    await fireEvent.pointerUp(container.querySelector('.file-address__breadcrumb')!);
    await component.beginEdit();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onBeginEdit).not.toHaveBeenCalled();
  });

  it('enters edit mode from the blank button, selects the known path, and submits', async () => {
    const { onBeginEdit, onSubmit } = renderAddressBar();
    const blank = screen.getByRole('button', { name: 'files.editAddress' });
    expect(blank.textContent).toBe('');
    expect(blank.querySelector('svg')).toBeNull();
    expect(blank.getAttribute('aria-keyshortcuts')).toBe('Alt+D F4');
    await fireEvent.click(blank);

    const input = screen.getByRole('textbox', { name: 'files.addressLabel' }) as HTMLInputElement;
    expect(input.value).toBe('/Projects');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(onBeginEdit).toHaveBeenCalledOnce();

    await fireEvent.input(input, { target: { value: '/Projects/2026' } });
    await fireEvent.submit(input.closest('form')!);
    expect(onSubmit).toHaveBeenCalledWith('/Projects/2026');
  });

  it.each(['.file-address__view', '.file-address__breadcrumb', '.cfms-breadcrumb-container', '.cfms-breadcrumb'])('enters from real blank space in %s and supports Escape cancellation', async (selector) => {
    const { container, onCancel } = renderAddressBar({ knownPath: null });
    await fireEvent.pointerUp(container.querySelector(selector)!);
    const input = screen.getByRole('textbox', { name: 'files.addressLabel' });
    expect((input as HTMLInputElement).value).toBe('');

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('clears the path without cancelling or submitting and keeps the input focused', async () => {
    const { component, onSubmit, onCancel } = renderAddressBar();
    await component.beginEdit();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(screen.queryByRole('button', { name: 'common.cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'files.addressGo' })).toBeNull();

    const clear = screen.getByRole('button', { name: 'common.clear' });
    await fireEvent.pointerDown(input);
    await fireEvent.pointerDown(input.closest('form')!);
    await fireEvent.pointerDown(clear.querySelector('svg')!);
    expect(screen.getByRole('textbox')).toBe(input);
    clear.focus();
    await fireEvent.click(clear);

    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'common.clear' })).toBeNull();

    await fireEvent.input(input, { target: { value: '/Other' } });
    expect(screen.getByRole('button', { name: 'common.clear' })).toBeTruthy();
    await fireEvent.submit(input.closest('form')!);
    expect(onSubmit).toHaveBeenCalledWith('/Other');
  });

  it.each([
    { busy: false, error: null },
    { busy: true, error: null },
    { busy: false, error: 'files.addressUnavailable' },
  ])('cancels outside presses without blocking the pressed control (%j)', async (state) => {
    const { component, container, rerender, onCancel, onSubmit } = renderAddressBar();
    await component.beginEdit();
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '/Draft' } });
    await rerender(state);

    const outside = document.createElement('button');
    const onClick = vi.fn(() => expect(onCancel).toHaveBeenCalledOnce());
    outside.addEventListener('click', onClick);
    container.append(outside);
    expect(await fireEvent.pointerDown(outside)).toBe(true);
    outside.focus();
    await fireEvent.click(outside);

    expect(onClick).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(outside);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('navigation')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    await fireEvent.pointerDown(document.body);
    expect(onCancel).toHaveBeenCalledOnce();

    await rerender({ busy: false, error: null });
    await component.beginEdit();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('/Projects');
  });

  it.each([null, 'files.addressUnavailable'])('treats supporting text as outside the editor (error=%s)', async (error) => {
    const { component, container, rerender, onCancel } = renderAddressBar();
    await component.beginEdit();
    await rerender({ error });
    await fireEvent.pointerDown(container.querySelector('.file-address__support')!);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps editing through keyboard focus changes and presses on the progress indicator', async () => {
    const { component, container, rerender, onCancel } = renderAddressBar();
    await component.beginEdit();
    const input = screen.getByRole('textbox');
    await fireEvent.keyDown(input, { key: 'Tab' });
    screen.getByRole('button', { name: 'common.clear' }).focus();
    expect(screen.getByRole('textbox')).toBe(input);
    await rerender({ busy: true });
    await fireEvent.pointerDown(container.querySelector('.file-address__progress')!);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('removes the outside listener on finish and unmount, and registers it again on reentry', async () => {
    const addListener = vi.spyOn(document, 'addEventListener');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { component, unmount, onCancel } = renderAddressBar();
    await component.beginEdit();
    const firstListener = addListener.mock.calls.find(([type, , capture]) => type === 'pointerdown' && capture === true)![1];
    component.finishEdit();
    await fireEvent.pointerDown(document.body);
    expect(removeListener).toHaveBeenCalledWith('pointerdown', firstListener, true);
    expect(onCancel).not.toHaveBeenCalled();

    await component.beginEdit();
    const listeners = addListener.mock.calls.filter(([type, , capture]) => type === 'pointerdown' && capture === true);
    expect(listeners).toHaveLength(2);
    unmount();
    expect(removeListener).toHaveBeenCalledWith('pointerdown', listeners[1][1], true);
    await fireEvent.pointerDown(document.body);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows progress while resolving and prevents clearing or repeated submission', async () => {
    const { component, rerender, onSubmit } = renderAddressBar();
    await component.beginEdit();
    await rerender({ busy: true });

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(screen.getByRole('status', { name: 'files.addressResolving' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common.clear' })).toBeNull();
    await fireEvent.submit(input.closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not edit when clicking a directory, the current label or a separator', async () => {
    const { onNavigate, onBeginEdit } = renderAddressBar({
      segments: [{ label: 'Parent', path: 'parent-id' }, { label: 'Projects', path: 'projects-id' }],
    });
    const nav = screen.getByRole('navigation');
    const parent = within(nav).getByRole('button', { name: 'Parent' });
    await fireEvent.pointerUp(parent);
    await fireEvent.click(parent);
    await fireEvent.pointerUp(within(nav).getByText('Projects'));
    await fireEvent.pointerUp(nav.querySelector('[data-breadcrumb-separator]')!);
    expect(onNavigate).toHaveBeenCalledWith('parent-id');
    expect(onBeginEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('ignores secondary-button releases and blocks every edit entry while busy', async () => {
    const { component, container, rerender, onBeginEdit } = renderAddressBar();
    // jsdom has no PointerEvent constructor; define the button on a bubbling event.
    const secondaryRelease = new Event('pointerup', { bubbles: true });
    Object.defineProperty(secondaryRelease, 'button', { value: 2 });
    await fireEvent(container.querySelector('.file-address__breadcrumb')!, secondaryRelease);
    expect(onBeginEdit).not.toHaveBeenCalled();

    await rerender({ busy: true });
    await fireEvent.pointerUp(container.querySelector('.file-address__breadcrumb')!);
    await fireEvent.click(screen.getByRole('button', { name: 'files.editAddress' }));
    await component.beginEdit();
    expect(onBeginEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps the input and announces inline errors', async () => {
    const { component, rerender } = renderAddressBar();
    await component.beginEdit();
    await rerender({
      segments: [{ label: 'Projects', path: 'projects' }],
      lookupEnabled: true,
      knownPath: '/Projects',
      busy: false,
      error: 'files.addressUnavailable',
      onNavigate: vi.fn(),
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      onBeginEdit: vi.fn(),
    });

    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('files.addressUnavailable');
  });
});
