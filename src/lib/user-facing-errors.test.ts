import { beforeEach, describe, expect, it } from 'vitest';
import { locale, waitLocale } from 'svelte-i18n';
import './i18n';
import { formatUserFacingError } from './user-facing-errors';

describe('user-facing server errors', () => {
  beforeEach(async () => {
    locale.set('en');
    await waitLocale();
  });

  it('formats rate limits with and without a retry delay', () => {
    expect(formatUserFacingError('Server returned 429: slow down')).toBe(
      'Too many requests. Try again in a moment.',
    );
    expect(formatUserFacingError(
      'Server returned 429: slow down\nCFMS_ERROR_DATA:{"retry_after_seconds":12}',
    )).toBe('Too many requests. Try again in 12 seconds.');
    expect(formatUserFacingError('server rejected request (429): slow down')).toBe(
      'Too many requests. Try again in a moment.',
    );
  });

  it('formats server capacity responses in Chinese', async () => {
    locale.set('zh-CN');
    await waitLocale();

    expect(formatUserFacingError('Server returned 503: busy')).toBe(
      '服务器当前繁忙，请稍后重试。',
    );
    expect(formatUserFacingError(
      'Server returned 503: busy\nCFMS_ERROR_DATA:{"retry_after_seconds":3}',
    )).toBe('服务器当前繁忙，请在 3 秒后重试。');
  });

  it('keeps non-availability metadata out of display text', () => {
    expect(formatUserFacingError(
      'Server returned 403: denied\nCFMS_ERROR_DATA:{"scope":"account"}',
    )).toBe('Server returned 403: denied');
  });

  it('explains retained transfer records in the current locale', async () => {
    const error = 'Cancellation was not confirmed within 10 seconds. The record was kept; try again.';
    expect(formatUserFacingError(error)).toBe('Stopping was not confirmed within 10 seconds. The record was kept. Try again.');
    locale.set('zh-CN');
    await waitLocale();
    expect(formatUserFacingError(error)).toBe('10 秒内未确认任务停止，记录已保留，请稍后重试。');
  });
});
