// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
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

afterEach(cleanup);

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
  it('keeps the breadcrumb unchanged when lookup support is disabled', () => {
    renderAddressBar({ lookupEnabled: false });
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'files.editAddress' })).toBeNull();
  });

  it('enters edit mode from the button, prefills the known path, and submits', async () => {
    const { onBeginEdit, onSubmit } = renderAddressBar();
    await fireEvent.click(screen.getByRole('button', { name: 'files.editAddress' }));

    const input = screen.getByRole('textbox', { name: 'files.addressLabel' });
    expect((input as HTMLInputElement).value).toBe('/Projects');
    expect(onBeginEdit).toHaveBeenCalledOnce();

    await fireEvent.input(input, { target: { value: '/Projects/2026' } });
    await fireEvent.submit(input.closest('form')!);
    expect(onSubmit).toHaveBeenCalledWith('/Projects/2026');
  });

  it('supports blank-area entry and Escape cancellation', async () => {
    const { container, onCancel } = renderAddressBar({ knownPath: null });
    await fireEvent.pointerUp(container.querySelector('.file-address__view')!);
    const input = screen.getByRole('textbox', { name: 'files.addressLabel' });
    expect((input as HTMLInputElement).value).toBe('');

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
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
