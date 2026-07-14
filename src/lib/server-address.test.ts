import { describe, expect, it } from 'vitest';
import { isServerAddressValid, parseServerAddress } from './server-address';

describe('server address parsing', () => {
  it.each([
    'localhost:5104',
    'fileserver:1',
    'example.com:443',
    'sub-domain.example.com:65535',
    'example.com.:5104',
    '127.0.0.1:5104',
    '0.0.0.0:80',
    '[::1]:5104',
    '[2001:db8::1]:65535',
    '例子.测试:443',
  ])('accepts %s', (address) => {
    expect(isServerAddressValid(address)).toBe(true);
  });

  it('trims the complete authority and returns connection-ready parts', () => {
    expect(parseServerAddress('  [2001:db8::1]:5104  ')).toEqual({
      address: '[2001:db8::1]:5104',
      host: '2001:db8::1',
      port: 5104,
    });
  });

  it.each([
    '',
    'example.com',
    ':5104',
    'example.com:',
    'example.com:0',
    'example.com:65536',
    'example.com:+443',
    'example.com:1.5',
    'wss://example.com:5104',
    'user@example.com:5104',
    'example.com:5104/path',
    'example.com:5104?query',
    'example.com:5104#fragment',
    'example .com:5104',
    'example_com:5104',
    '-example.com:5104',
    'example-.com:5104',
    'example..com:5104',
    '2001:db8::1:5104',
    '[2001:db8::1]5104',
    '[not-ipv6]:5104',
    '256.0.0.1:5104',
    '127.1:5104',
    '127.00.0.1:5104',
    '2130706433:5104',
    '0x7f000001:5104',
    `${'a'.repeat(64)}.example:5104`,
  ])('rejects %s', (address) => {
    expect(isServerAddressValid(address)).toBe(false);
  });
});
