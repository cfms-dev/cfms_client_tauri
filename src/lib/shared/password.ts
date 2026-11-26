const PASSWORD_LOWER = 'abcdefghijkmnpqrstuvwxyz';
const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_DIGITS = '23456789';
const PASSWORD_SYMBOLS = '!@#$%^&*()-_=+[]{}';
const PASSWORD_ALL = PASSWORD_LOWER + PASSWORD_UPPER + PASSWORD_DIGITS + PASSWORD_SYMBOLS;

const STRENGTH_LABEL_KEYS = [
  'dialog.changePassword.veryWeak',
  'dialog.changePassword.weak',
  'dialog.changePassword.fair',
  'dialog.changePassword.good',
  'dialog.changePassword.strong',
  'dialog.changePassword.strong',
] as const;

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

/**
 * Generate a strong random password with guaranteed character-class coverage
 * (lower + upper + digit + symbol) using `crypto.getRandomValues`.
 */
export function generateRandomPassword(length = 16): string {
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [
    pick(PASSWORD_LOWER),
    pick(PASSWORD_UPPER),
    pick(PASSWORD_DIGITS),
    pick(PASSWORD_SYMBOLS),
  ];

  for (let i = chars.length; i < length; i++) {
    chars.push(pick(PASSWORD_ALL));
  }

  // Fisher-Yates shuffle so guaranteed-class characters are not always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

/** Advisory client-side password strength score (0-5) and i18n label key. */
export function estimatePasswordStrength(password: string): { score: number; labelKey: string } {
  if (!password) return { score: 0, labelKey: '' };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  return { score, labelKey: STRENGTH_LABEL_KEYS[score] };
}
