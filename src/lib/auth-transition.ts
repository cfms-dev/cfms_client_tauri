const CONNECT_TO_LOGIN_TRANSITION_KEY = 'cfms.connectToLoginTransition';
const LOGIN_TO_CONNECT_TRANSITION_KEY = 'cfms.loginToConnectTransition';
const CONNECT_TO_UTILITY_TRANSITION_KEY = 'cfms.connectToUtilityTransition';

export function markConnectToLoginTransition() {
  markTransition(CONNECT_TO_LOGIN_TRANSITION_KEY);
}

export function consumeConnectToLoginTransition() {
  return consumeTransition(CONNECT_TO_LOGIN_TRANSITION_KEY);
}

export function markLoginToConnectTransition() {
  markTransition(LOGIN_TO_CONNECT_TRANSITION_KEY);
}

export function consumeLoginToConnectTransition() {
  return consumeTransition(LOGIN_TO_CONNECT_TRANSITION_KEY);
}

export function markConnectToUtilityTransition() {
  markTransition(CONNECT_TO_UTILITY_TRANSITION_KEY);
}

export function consumeConnectToUtilityTransition() {
  return consumeTransition(CONNECT_TO_UTILITY_TRANSITION_KEY);
}

function markTransition(key: string) {
  if (typeof sessionStorage === 'undefined') return;

  try {
    sessionStorage.setItem(key, '1');
  } catch {
    /* Storage can be unavailable in restricted webviews. */
  }
}

function consumeTransition(key: string) {
  if (typeof sessionStorage === 'undefined') return false;

  try {
    const shouldPlay = sessionStorage.getItem(key) === '1';
    sessionStorage.removeItem(key);
    return shouldPlay;
  } catch {
    return false;
  }
}
