/** Dark-only vault theme. */

export const colors = {
  bg: '#0B0E14',
  surface: '#141A24',
  surfaceAlt: '#1D2532',
  border: '#26303F',
  text: '#E8EDF4',
  textDim: '#8A94A6',
  accent: '#4FD1A5',
  accentDim: '#2C4A40',
  danger: '#F26D6D',
  overlay: 'rgba(11, 14, 20, 0.92)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  full: 999,
} as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
