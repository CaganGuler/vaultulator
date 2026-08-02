/**
 * The calculator's pure logic.
 *
 * `isPinEntry` is the front door's security boundary — it alone decides which
 * keystrokes get checked against the vault — and `format` is the kind of
 * floating-point code that regresses silently.
 */
import { apply, format, isPinEntry, type Pending } from '../calculator';
import { PIN_LENGTH } from '../../lib/crypto/keys';

const pending = (op: Pending['op'], value: number): Pending => ({ op, value });

describe('arithmetic', () => {
  it('applies each operator', () => {
    expect(apply(pending('+', 2), 3)).toBe(5);
    expect(apply(pending('−', 5), 3)).toBe(2);
    expect(apply(pending('×', 4), 2.5)).toBe(10);
    expect(apply(pending('÷', 9), 3)).toBe(3);
  });

  it('returns NaN for division by zero rather than Infinity', () => {
    expect(apply(pending('÷', 1), 0)).toBeNaN();
  });
});

describe('display formatting', () => {
  it('hides binary floating-point noise', () => {
    expect(format(0.1 + 0.2)).toBe('0.3');
    expect(format(1 / 3)).toBe('0.3333333333');
  });

  it('shows an error for non-finite results', () => {
    expect(format(NaN)).toBe('Hata');
    expect(format(Infinity)).toBe('Hata');
  });

  it('falls back to exponential past the digit limit', () => {
    expect(format(1234567890123456)).toContain('e+');
    expect(format(123456789012)).toBe('123456789012'); // exactly 12 digits fits
  });

  it('keeps small and negative values readable', () => {
    expect(format(0)).toBe('0');
    expect(format(-42)).toBe('-42');
  });
});

describe('isPinEntry — what counts as an unlock attempt', () => {
  const digits = '1'.repeat(PIN_LENGTH);

  it('accepts exactly PIN_LENGTH bare digits with no pending operation', () => {
    expect(isPinEntry(digits, null)).toBe(true);
  });

  it('rejects anything mid-calculation', () => {
    // Otherwise a real calculation ending in the PIN would open the vault in
    // front of whoever is watching.
    expect(isPinEntry(digits, pending('+', 1))).toBe(false);
  });

  it('rejects the wrong number of digits', () => {
    expect(isPinEntry('1'.repeat(PIN_LENGTH - 1), null)).toBe(false);
    expect(isPinEntry('1'.repeat(PIN_LENGTH + 1), null)).toBe(false);
    expect(isPinEntry('', null)).toBe(false);
  });

  it('rejects anything that is not plain digits', () => {
    expect(isPinEntry(`-${digits.slice(1)}`, null)).toBe(false);
    expect(isPinEntry(`${digits.slice(0, -2)}.5`, null)).toBe(false);
    expect(isPinEntry('1e+5678', null)).toBe(false);
    expect(isPinEntry('Hata', null)).toBe(false);
  });
});
