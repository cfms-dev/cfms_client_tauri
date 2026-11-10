// @vitest-environment jsdom

import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
import SchedulesPage from '$lib/app/schedules/SchedulesPage.svelte';

const mocks = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listScheduledTaskTypes: vi.fn(),
  getSchedule: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
}));

vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  ...mocks,
}));

const schedule = {
  id: 'schedule-1',
  task_name: 'reports.weekly',
  task_contract_version: 1,
  task_available: true,
  payload: { format: 'pdf' },
  trigger: {
    type: 'cron' as const,
    data: { expression: '0 8 * * 1' },
    timezone: 'Asia/Shanghai',
  },
  enabled: true,
  status: 'active' as const,
  revision: 2,
  next_run_at: 1_789_000_000,
  active_execution_id: null,
  pending_scheduled_for: null,
  created_by: 'admin',
  created_at: 1_788_000_000,
  updated_by: 'admin',
  updated_at: 1_788_000_100,
};

const taskType = {
  name: 'reports.weekly',
  contract_version: 1,
  required_permission: 'manage_system',
  payload_schema: { type: 'object' },
  max_attempts: 3,
};

function signIn(permissions: string[]) {
  authStore.apply({
    username: 'admin', user_id: 'aabbccdd-0000-4000-8000-000000000002',
    nickname: 'Administrator',
    has_token: true,
    token_exp: 1_900_000_000,
    permissions,
    groups: [],
  });
  serverStateStore.connected = true;
}

beforeEach(() => {
  locale.set('en');
  authStore.clear();
  serverStateStore.clear();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listSchedules.mockResolvedValue({
    items: [schedule],
    page_size: 64,
    next_cursor: null,
    has_more: false,
  });
  mocks.listScheduledTaskTypes.mockResolvedValue([taskType]);
  mocks.getSchedule.mockResolvedValue(schedule);
  mocks.createSchedule.mockResolvedValue({ ...schedule, id: 'schedule-2', revision: 1 });
  notificationStore.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  authStore.clear();
  serverStateStore.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('schedules page', () => {
  it('does not call scheduling actions without view permission', () => {
    signIn([]);
    render(SchedulesPage);

    expect(screen.getByRole('heading', { name: 'Schedules unavailable' })).toBeTruthy();
    expect(mocks.listSchedules).not.toHaveBeenCalled();
    expect(mocks.listScheduledTaskTypes).not.toHaveBeenCalled();
  });

  it('loads the core protocol 27 schedule ledger without an extension flag', async () => {
    signIn(['view_schedules']);
    render(SchedulesPage);

    await waitFor(() => expect(mocks.listSchedules).toHaveBeenCalledWith(null, 64, false));
    expect(await screen.findByText('reports.weekly')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New schedule' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: /reports\.weekly/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'reports.weekly' })).toBeTruthy();
    expect(screen.getByText('schedule-1')).toBeTruthy();
  });

  it('offers the generic extension-backed editor to schedule managers', async () => {
    signIn(['view_schedules', 'manage_schedules', 'manage_system']);
    render(SchedulesPage);

    await screen.findByText('reports.weekly');
    await fireEvent.click(screen.getByRole('button', { name: 'New schedule' }));

    expect(screen.getByRole('heading', { level: 2, name: 'Create schedule' })).toBeTruthy();
    expect((screen.getByLabelText('Task type') as HTMLSelectElement).value).toBe('reports.weekly');
    expect(screen.getByRole('tab', { name: 'Form' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('This task has no configurable payload fields.')).toBeTruthy();

    const createButtons = screen.getAllByRole('button', { name: 'New schedule' });
    await waitFor(() => expect((createButtons.at(-1) as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(createButtons.at(-1)!);
    await waitFor(() => expect(mocks.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      taskName: 'reports.weekly',
      payload: {},
      enabled: true,
    })));
  });

  it('does not offer task mutations when the task-type permission is absent', async () => {
    mocks.listScheduledTaskTypes.mockResolvedValue([]);
    signIn(['view_schedules', 'manage_schedules']);
    render(SchedulesPage);

    await screen.findByText('reports.weekly');
    const createButton = screen.getByRole('button', { name: 'New schedule' }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    expect(createButton.getAttribute('aria-describedby')).toBe('schedule-create-unavailable');
    const help = screen.getByRole('button', { name: 'Why is New schedule unavailable?' });
    expect(help.getAttribute('aria-describedby')).toBe('schedule-create-unavailable');
    expect(help.hasAttribute('icon-only')).toBe(true);
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.id).toBe('schedule-create-unavailable');
    expect(tooltip.hidden).toBe(true);
    expect(tooltip.parentElement).toBe(document.body);
    expect(screen.getByText(/No schedulable task types are available to this account/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('switch', { name: 'Toggle reports.weekly' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the help visible while moving from the button into the portaled tooltip', async () => {
    mocks.listScheduledTaskTypes.mockResolvedValue([]);
    signIn(['view_schedules', 'manage_schedules']);
    render(SchedulesPage);
    const help = await screen.findByRole('button', { name: 'Why is New schedule unavailable?' });
    vi.useFakeTimers();

    await fireEvent.pointerEnter(help);
    const tooltip = screen.getByRole('tooltip');
    await fireEvent.pointerLeave(help);
    await vi.advanceTimersByTimeAsync(60);
    await fireEvent.pointerEnter(tooltip);
    await vi.advanceTimersByTimeAsync(120);
    expect(tooltip.hidden).toBe(false);

    await fireEvent.pointerLeave(tooltip);
    await vi.advanceTimersByTimeAsync(119);
    expect(tooltip.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(tooltip.hidden).toBe(true);
  });

  it('shows keyboard help, dismisses it with Escape, and removes portal listeners on unmount', async () => {
    mocks.listScheduledTaskTypes.mockResolvedValue([]);
    signIn(['view_schedules', 'manage_schedules']);
    const view = render(SchedulesPage);
    const help = await screen.findByRole('button', { name: 'Why is New schedule unavailable?' });
    await fireEvent.focus(help);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.parentElement).toBe(document.body);
    await fireEvent.keyDown(help, { key: 'Escape' });
    expect(tooltip.hidden).toBe(true);

    await fireEvent.blur(help);
    await fireEvent.focus(help);
    expect(tooltip.hidden).toBe(false);
    const removeListener = vi.spyOn(window, 'removeEventListener');
    vi.useFakeTimers();
    await fireEvent.blur(help);
    view.unmount();
    expect(document.getElementById('schedule-create-unavailable')).toBeNull();
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('toggles touch help and dismisses it by touching outside the tooltip', async () => {
    mocks.listScheduledTaskTypes.mockResolvedValue([]);
    signIn(['view_schedules', 'manage_schedules']);
    render(SchedulesPage);
    const help = await screen.findByRole('button', { name: 'Why is New schedule unavailable?' });
    const touch = () => fireEvent(help, Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: 'touch' }));
    await touch();
    await fireEvent.focus(help);
    await fireEvent.click(help);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.hidden).toBe(false);

    await touch();
    await fireEvent.click(help);
    expect(tooltip.hidden).toBe(true);
    await touch();
    await fireEvent.click(help);
    expect(tooltip.hidden).toBe(false);
    await fireEvent.pointerDown(document.body);
    expect(tooltip.hidden).toBe(true);
  });

  it('keeps help inside the viewport and repositions it on scroll and resize', async () => {
    mocks.listScheduledTaskTypes.mockResolvedValue([]);
    signIn(['view_schedules', 'manage_schedules']);
    render(SchedulesPage);
    const help = await screen.findByRole('button', { name: 'Why is New schedule unavailable?' });
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    const anchorBounds = vi.spyOn(help.parentElement!, 'getBoundingClientRect');
    anchorBounds.mockReturnValue({ top: 20, right: 80, bottom: 52 } as DOMRect);
    vi.spyOn(tooltip, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 60 } as DOMRect);

    await fireEvent.focus(help);
    expect(tooltip.style.left).toBe('16px');
    expect(tooltip.style.top).toBe('60px');

    anchorBounds.mockReturnValue({ top: window.innerHeight - 40, right: window.innerWidth + 20, bottom: window.innerHeight - 8 } as DOMRect);
    await fireEvent.scroll(window);
    expect(tooltip.style.left).toBe(`${window.innerWidth - 416}px`);
    expect(tooltip.style.top).toBe(`${window.innerHeight - 108}px`);

    anchorBounds.mockReturnValue({ top: 30, right: 450, bottom: 62 } as DOMRect);
    await fireEvent.resize(window);
    expect(tooltip.style.left).toBe('50px');
    expect(tooltip.style.top).toBe('70px');
  });

  it('delegates the search input focus ring to its composite field', async () => {
    signIn(['view_schedules']);
    render(SchedulesPage);

    await screen.findByText('reports.weekly');
    expect(screen.getByPlaceholderText('Search this page by task, ID, or owner').getAttribute('data-focus-ring')).toBe('delegated');
  });

  it('toggles a schedule inline without opening details or showing success feedback', async () => {
    const updated = { ...schedule, enabled: false, revision: 3 };
    mocks.updateSchedule.mockResolvedValue(updated);
    const success = vi.spyOn(notificationStore, 'success');
    signIn(['view_schedules', 'manage_schedules', 'manage_system']);
    render(SchedulesPage);

    await screen.findByText('reports.weekly');
    await fireEvent.click(screen.getByRole('switch', { name: 'Toggle reports.weekly' }));

    await waitFor(() => expect(mocks.updateSchedule).toHaveBeenCalledWith({
      id: 'schedule-1',
      revision: 2,
      enabled: false,
    }));
    expect(screen.queryByRole('heading', { level: 2, name: 'reports.weekly' })).toBeNull();
    expect(success).not.toHaveBeenCalled();
  });

  it('keeps failure feedback when toggling a schedule fails', async () => {
    mocks.updateSchedule.mockRejectedValue(new Error('Unable to update schedule'));
    const error = vi.spyOn(notificationStore, 'error');
    signIn(['view_schedules', 'manage_schedules', 'manage_system']);
    render(SchedulesPage);

    await screen.findByText('reports.weekly');
    await fireEvent.click(screen.getByRole('switch', { name: 'Toggle reports.weekly' }));

    await waitFor(() => expect(error).toHaveBeenCalled());
  });
});
