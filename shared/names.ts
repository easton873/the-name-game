// Name rules shared by the server and the phones (so the phone can disable the button live).

export const MAX_NAME_LENGTH = 24;
/** Symbols allowed in a secret name on top of letters, numbers and spaces (so P!nk is possible). */
export const ALLOWED_SYMBOLS = '$!&@';

const ALLOWED_CHAR = /^[\p{L}\p{M}\p{Nd} $!&@]$/u;

export type NameCheck = { ok: true; name: string } | { ok: false; error: string; empty?: boolean };

/** Collapse whitespace and check every character. `name` is the cleaned display name. */
export function validateName(raw: unknown): NameCheck {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'Write a name first!', empty: true };
  const bad = [...new Set(Array.from(name).filter((c) => !ALLOWED_CHAR.test(c)))];
  if (bad.length) {
    return {
      ok: false,
      error: `You used a symbol that can't be used (${bad.join(' ')}). Names can only use letters, numbers, spaces, or one of these symbols: ${[...ALLOWED_SYMBOLS].join(' ')}`,
    };
  }
  if (!/[\p{L}\p{Nd}]/u.test(name)) return { ok: false, error: 'Use at least one letter or number.' };
  if (Array.from(name).length > MAX_NAME_LENGTH) return { ok: false, error: `Keep it to ${MAX_NAME_LENGTH} characters.` };
  return { ok: true, name };
}

/** Case, accents and extra spaces don't matter when matching names. Every part of the name still does. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
