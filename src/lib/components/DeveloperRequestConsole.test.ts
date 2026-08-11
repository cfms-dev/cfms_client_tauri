// @vitest-environment jsdom

import '$lib/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeveloperRequestConsole from './DeveloperRequestConsole.svelte';

const apiMocks = vi.hoisted(() => ({
  sendDeveloperRequest: vi.fn(),
}));

vi.mock('$lib/api', () => ({
  sendDeveloperRequest: apiMocks.sendDeveloperRequest,
}));

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));

vi.mock('$lib/platform', () => ({
  isMobilePlatform: () => false,
}));

Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: () => {
    const animation = {
      cancel: vi.fn(),
      currentTime: 0,
      effect: {},
      onfinish: null as (() => void) | null,
      playState: 'finished',
    };
    queueMicrotask(() => animation.onfinish?.());
    return animation;
  },
});

beforeEach(() => {
  locale.set('en');
  apiMocks.sendDeveloperRequest.mockReset();
});

afterEach(cleanup);

function renderConsole(scopeKey = 'server.example:developer') {
  return render(DeveloperRequestConsole, {
    props: {
      open: true,
      onClose: vi.fn(),
      serverAddress: 'server.example',
      username: 'developer',
      scopeKey,
    },
  });
}

async function fillRequest(action: string, payload: string) {
  await fireEvent.input(screen.getByLabelText('Business name'), { target: { value: action } });
  await fireEvent.input(screen.getByLabelText('Payload (JSON)'), { target: { value: payload } });
}

describe('DeveloperRequestConsole', () => {
  it('blocks empty business names and invalid JSON before invoking the backend', async () => {
    renderConsole();

    await fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByText('Enter a business name.')).toBeTruthy();
    expect(apiMocks.sendDeveloperRequest).not.toHaveBeenCalled();

    await fillRequest('get_document', '{not-json}');
    await fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByText(/Invalid JSON:/)).toBeTruthy();
    expect(apiMocks.sendDeveloperRequest).not.toHaveBeenCalled();
  });

  it('accepts any JSON value and displays the complete non-200 response envelope', async () => {
    apiMocks.sendDeveloperRequest.mockResolvedValue({
      code: 403,
      message: 'Forbidden',
      data: { reason: 'permission_denied' },
      timestamp: 1_723_456_789.25,
    });
    renderConsole();
    await fillRequest('custom_business', 'null');

    await fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(apiMocks.sendDeveloperRequest).toHaveBeenCalledWith('custom_business', null));
    expect(await screen.findByText('Forbidden')).toBeTruthy();
    const result = screen.getByLabelText('Complete response content') as HTMLTextAreaElement;
    expect(result.readOnly).toBe(true);
    expect(result.value).toContain('"code": 403');
    expect(result.value).toContain('"reason": "permission_denied"');
    expect(screen.getAllByText('403').length).toBeGreaterThan(0);
  });

  it('separates client transport failures from server responses', async () => {
    apiMocks.sendDeveloperRequest.mockRejectedValue('Connection closed before custom_business response');
    renderConsole();
    await fillRequest('custom_business', '{}');

    await fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText('The client could not complete this request.')).toBeTruthy();
    expect((screen.getByLabelText('Complete response content') as HTMLTextAreaElement).value)
      .toContain('Connection closed');
    expect(screen.getAllByText('Client error').length).toBeGreaterThan(0);
  });

  it('prevents duplicate sends while a request is pending', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    apiMocks.sendDeveloperRequest.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    renderConsole();
    await fillRequest('slow_business', '{}');

    const sendButton = screen.getByRole('button', { name: 'Send request' });
    await fireEvent.click(sendButton);
    expect(screen.getByRole('button', { name: 'Sending...' })).toHaveProperty('disabled', true);
    await fireEvent.click(screen.getByRole('button', { name: 'Sending...' }));
    expect(apiMocks.sendDeveloperRequest).toHaveBeenCalledTimes(1);

    resolveRequest?.({ code: 200, message: 'OK', data: {}, timestamp: 1 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toHaveProperty('disabled', false));
  });

  it('retains request history across closing props but clears it when identity scope changes', async () => {
    apiMocks.sendDeveloperRequest.mockResolvedValue({
      code: 200,
      message: 'OK',
      data: { value: 1 },
      timestamp: 1,
    });
    const view = renderConsole();
    await fillRequest('first_business', '{"value":1}');
    await fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByText('OK');

    await view.rerender({
      open: false,
      onClose: vi.fn(),
      serverAddress: 'server.example',
      username: 'developer',
      scopeKey: 'server.example:developer',
    });
    await view.rerender({
      open: true,
      onClose: vi.fn(),
      serverAddress: 'server.example',
      username: 'developer',
      scopeKey: 'server.example:developer',
    });
    expect(screen.getAllByText('first_business').length).toBeGreaterThan(0);

    await view.rerender({
      open: true,
      onClose: vi.fn(),
      serverAddress: 'other.example',
      username: 'another-user',
      scopeKey: 'other.example:another-user',
    });
    await waitFor(() => expect(screen.getByText('Requests from this app session will appear here.')).toBeTruthy());
    expect((screen.getByLabelText('Business name') as HTMLInputElement).value).toBe('');
  });

  it('caps session history at thirty requests and restores a selected request', async () => {
    apiMocks.sendDeveloperRequest.mockImplementation(async (action: string) => ({
      code: 200,
      message: 'OK',
      data: { action },
      timestamp: 1,
    }));
    renderConsole();

    for (let index = 0; index < 31; index += 1) {
      await fillRequest(`business_${index}`, JSON.stringify({ index }));
      await fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
      await waitFor(() => expect(apiMocks.sendDeveloperRequest).toHaveBeenCalledTimes(index + 1));
    }

    expect(document.querySelectorAll('.history-entry')).toHaveLength(30);
    expect(screen.queryByText('business_0')).toBeNull();
    await fireEvent.click(screen.getByText('business_12'));
    expect((screen.getByLabelText('Business name') as HTMLInputElement).value).toBe('business_12');
    expect((screen.getByLabelText('Payload (JSON)') as HTMLTextAreaElement).value).toContain('"index":12');
  });
});
