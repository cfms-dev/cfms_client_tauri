import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import type { Switch, TextInput } from '@fluentui/web-components';
import MdSwitch from '$lib/shared/ui/MdSwitch.svelte';
import MdCheckbox from '$lib/shared/ui/MdCheckbox.svelte';
import FluentButton from '$lib/shared/ui/FluentButton.svelte';
import FluentTextInput from '$lib/shared/ui/FluentTextInput.svelte';
import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });
const children = createRawSnippet(() => ({ render: () => '<span>Continue</span>' }));

describe('Svelte / Fluent interoperability', () => {
  it('keeps native input labelling and form behavior when trailing actions are supplied', async () => {
    const input = createRawSnippet(() => ({ render: () => '<input id="password-with-end" type="password" data-focus-ring="delegated" />' }));
    const end = createRawSnippet(() => ({ render: () => '<button type="button">Show password</button>' }));
    const form = document.createElement('form');
    document.body.append(form);
    const submit = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submit);
    const view = render(MdOutlinedField, { target: form, props: { inputId: 'password-with-end', label: 'Password', children: input, end } });
    const control = screen.getByLabelText('Password') as HTMLInputElement;
    expect(control.labels).toHaveLength(1);
    expect(control.type).toBe('password');
    await fireEvent.input(control, { target: { value: 'test-only-value' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(control.value).toBe('test-only-value');
    expect(submit).not.toHaveBeenCalled();
    await view.rerender({ inputId: 'password-with-end', label: 'Password', children: input, end: undefined });
    expect(screen.queryByRole('button', { name: 'Show password' })).toBeNull();
    expect(screen.getByLabelText('Password')).toBe(control);
  });

  it('associates the notched label with a native input without naming it twice', () => {
    const input = createRawSnippet(() => ({ render: () => '<input id="native-password" type="password" data-focus-ring="delegated" />' }));
    const view = render(MdOutlinedField, { inputId: 'native-password', label: 'Password', children: input });
    const control = screen.getByLabelText('Password') as HTMLInputElement;
    expect(control.labels).toHaveLength(1);
    expect(control.labels?.[0].htmlFor).toBe(control.id);
    expect(view.container.querySelector('fieldset')?.getAttribute('aria-hidden')).toBe('true');
    expect(control.closest('fieldset')).toBeNull();
  });

  it('keeps the visible Fluent label and native shadow label associated after relabelling', async () => {
    const view = render(FluentTextInput, { id: 'labelled-user', label: 'Username' });
    const host = screen.getByLabelText('Username') as TextInput;
    expect(view.container.querySelector('label')?.htmlFor).toBe(host.id);
    const input = host.shadowRoot!.querySelector('input')!;
    expect(input.labels).toHaveLength(1);
    const labelText = () => input.labels?.[0].querySelector('slot')?.assignedNodes({ flatten: true }).map(node => node.textContent).join('').trim();
    expect(labelText()).toBe('Username');
    await view.rerender({ id: 'labelled-user', label: '用户名', disabled: true });
    expect(screen.getByLabelText('用户名')).toBe(host);
    expect(labelText()).toBe('用户名');
    await waitFor(() => expect(input.disabled).toBe(true));
  });

  it('retains rich required labels and native multiline semantics', () => {
    const labelContent = createRawSnippet(() => ({ render: () => '<span>Reason <span aria-label="required">*</span></span>' }));
    const textarea = createRawSnippet(() => ({ render: () => '<textarea id="reason-field" data-focus-ring="delegated" rows="3" maxlength="1024"></textarea>' }));
    const view = render(MdOutlinedField, { inputId: 'reason-field', label: 'Reason', labelContent, children: textarea, error: true });
    const control = screen.getByRole('textbox', { name: /Reason/ }) as HTMLTextAreaElement;
    expect(control.labels).toHaveLength(1);
    expect(control.rows).toBe(3);
    expect(control.maxLength).toBe(1024);
    expect(view.container.querySelectorAll('fieldset[aria-hidden="true"]')).toHaveLength(1);
  });

  it('keeps text fields enabled by default and synchronizes the disabled attribute', async () => {
    const props = { id: 'search-material', label: 'Search files' };
    const view = render(FluentTextInput, props);
    const host = view.container.querySelector<TextInput>('fluent-text-input')!;
    expect(host.hasAttribute('disabled')).toBe(false);
    expect(host.disabled).toBe(false);
    await view.rerender({ ...props, disabled: true });
    expect(host.hasAttribute('disabled')).toBe(true);
    await view.rerender({ ...props, disabled: false });
    expect(host.hasAttribute('disabled')).toBe(false);
    expect(host.disabled).toBe(false);
  });

  it('keeps native and Fluent field density explicit when the requested size changes', async () => {
    const native = createRawSnippet(() => ({ render: () => '<input id="sized-native" data-focus-ring="delegated" />' }));
    const nativeView = render(MdOutlinedField, { inputId: 'sized-native', label: 'Native', children: native });
    expect(screen.getByLabelText('Native').closest('.cfms-field')?.getAttribute('data-control-size')).toBe('medium');
    await nativeView.rerender({ inputId: 'sized-native', label: 'Native', children: native, controlSize: 'large' });
    expect(screen.getByLabelText('Native').closest('.cfms-field')?.getAttribute('data-control-size')).toBe('large');

    const fluentView = render(FluentTextInput, { id: 'sized-fluent', label: 'Fluent', controlSize: 'small' });
    const host = screen.getByLabelText('Fluent');
    expect(host.getAttribute('control-size')).toBe('small');
    expect(host.closest('.cfms-field')?.getAttribute('data-control-size')).toBe('small');
    await fluentView.rerender({ id: 'sized-fluent', label: 'Fluent', controlSize: 'large' });
    expect(host.getAttribute('control-size')).toBe('large');
    expect(host.closest('.cfms-field')?.getAttribute('data-control-size')).toBe('large');
  });
  it('omits icon-only on labelled actions and adds it only for compact actions', async () => {
    const view = render(FluentButton, { children });
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button.hasAttribute('icon-only')).toBe(false);
    await view.rerender({ children, iconOnly: true });
    expect(button.hasAttribute('icon-only')).toBe(true);
    await view.rerender({ children, iconOnly: false });
    expect(button.hasAttribute('icon-only')).toBe(false);
  });

  it('keeps a switch disabled on first connection, then synchronizes a user change', async () => {
    const onChange = vi.fn();
    const view = render(MdSwitch, { checked: true, disabled: true, ariaLabel: 'Secure transport', onChange });
    const control = screen.getByRole('switch', { name: 'Secure transport' }) as Switch;
    expect(customElements.get('fluent-switch')).toBeDefined();
    expect(control.disabled).toBe(true);
    await fireEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
    await view.rerender({ checked: true, disabled: false, ariaLabel: 'Secure transport', onChange });
    await fireEvent.click(control);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('toggles the official checkbox from the keyboard', async () => {
    const onChange = vi.fn();
    render(MdCheckbox, { ariaLabel: 'Remember', onChange });
    const control = screen.getByRole('checkbox', { name: 'Remember' });
    await fireEvent.keyDown(control, { key: ' ' });
    await fireEvent.keyUp(control, { key: ' ' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(control.getAttribute('aria-checked')).toBe('true');
  });

  it('submits its associated form exactly once and honors click cancellation', async () => {
    const form = document.createElement('form');
    document.body.append(form);
    const submit = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submit);
    const onclick = vi.fn();
    const view = render(FluentButton, { target: form, props: { type: 'submit', children, onclick } });
    const control = screen.getByRole('button', { name: 'Continue' });
    await fireEvent.click(control);
    expect(submit).toHaveBeenCalledOnce();
    expect(onclick).toHaveBeenCalledOnce();
    await view.rerender({ type: 'submit', children, onclick: event => event.preventDefault() });
    await fireEvent.click(control);
    expect(submit).toHaveBeenCalledOnce();
  });

  it('synchronizes non-sensitive text from both the native input event and its parent', async () => {
    const oninput = vi.fn();
    const view = render(FluentTextInput, { id: 'user', label: 'Username', value: 'alice', oninput });
    const host = screen.getByLabelText('Username') as TextInput;
    const input = host.shadowRoot!.querySelector('input')!;
    await fireEvent.input(input, { target: { value: 'bob' } });
    expect(oninput).toHaveBeenCalledExactlyOnceWith('bob');
    await view.rerender({ id: 'user', label: 'Username', value: 'carol', oninput });
    await waitFor(() => expect(input.value).toBe('carol'));
    expect(host.value).toBe('carol');
  });

  it('puts validation semantics and its description in the focused control root', async () => {
    render(FluentTextInput, { id: 'user', label: 'Username', invalid: true, validationMessage: 'Username is required.' });
    const host = screen.getByLabelText('Username') as TextInput;
    const input = host.shadowRoot!.querySelector('input')!;
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    const descriptionId = input.getAttribute('aria-describedby')!;
    expect(host.shadowRoot!.getElementById(descriptionId)?.textContent).toBe('Username is required.');
  });

  it('lets a route cancel implicit Enter submission before the library handles it', async () => {
    const form = document.createElement('form');
    const button = document.createElement('button');
    button.type = 'submit';
    form.append(button);
    document.body.append(form);
    const submit = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submit);
    const view = render(FluentTextInput, {
      target: form, props: { id: 'user', label: 'Username', onkeydown: event => event.preventDefault() },
    });
    const input = screen.getByLabelText('Username').shadowRoot!.querySelector('input')!;
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
    await view.rerender({ id: 'user', label: 'Username', onkeydown: undefined });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).toHaveBeenCalledOnce();
  });
});
