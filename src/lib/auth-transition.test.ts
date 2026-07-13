import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumeConnectToUtilityTransition,
  markConnectToUtilityTransition,
} from './auth-transition';

describe('connect utility navigation marker', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('identifies only the next utility layout entered from the connect toolbar', () => {
    expect(consumeConnectToUtilityTransition()).toBe(false);

    markConnectToUtilityTransition();

    expect(consumeConnectToUtilityTransition()).toBe(true);
    expect(consumeConnectToUtilityTransition()).toBe(false);
  });
});
