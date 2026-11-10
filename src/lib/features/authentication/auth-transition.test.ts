import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumeConnectToLoginTransition,
  consumeLoginToConnectTransition,
  markConnectToLoginTransition,
  markLoginToConnectTransition,
} from '$lib/features/authentication/auth-transition';

describe('authentication navigation markers', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('consumes connect-to-login and login-to-connect transitions independently', () => {
    expect(consumeConnectToLoginTransition()).toBe(false);
    expect(consumeLoginToConnectTransition()).toBe(false);

    markConnectToLoginTransition();
    markLoginToConnectTransition();

    expect(consumeConnectToLoginTransition()).toBe(true);
    expect(consumeConnectToLoginTransition()).toBe(false);
    expect(consumeLoginToConnectTransition()).toBe(true);
    expect(consumeLoginToConnectTransition()).toBe(false);
  });
});
