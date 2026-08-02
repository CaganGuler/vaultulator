import { formatBytes, formatDuration } from '../theme';

describe('formatDuration', () => {
  it('formats under a minute with a zero minute field', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9_400)).toBe('0:09');
  });

  it('pads seconds', () => {
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(600_000)).toBe('10:00');
  });

  it('adds an hour field only past an hour', () => {
    expect(formatDuration(59 * 60_000 + 59_000)).toBe('59:59');
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_600_000 + 61_000)).toBe('1:01:01');
  });

  it('rounds to the nearest second rather than truncating', () => {
    expect(formatDuration(1_500)).toBe('0:02');
    expect(formatDuration(59_600)).toBe('1:00');
  });

  // recordAsync timing and the player's own metadata can disagree slightly, and
  // a negative value must not render as "0:0-3".
  it('clamps a negative duration', () => {
    expect(formatDuration(-5_000)).toBe('0:00');
  });
});

describe('formatBytes', () => {
  it('switches unit at each 1024 boundary', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
  });
});
