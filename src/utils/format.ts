export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatLines(n: number): string {
  return `~${formatNumber(n)} lines`;
}

export function monthsSince(isoDate: string | undefined): number | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  return Math.max(
    0,
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44),
  );
}

export function formatMonths(m: number | null | undefined): string {
  if (m === null || m === undefined) return "unknown";
  if (m < 1) return "less than a month ago";
  const rounded = Math.round(m);
  if (rounded <= 1) return "1 month ago";
  return `${rounded} months ago`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function truncateList(items: string[], max = 8): string[] {
  if (items.length <= max) return items;
  return [...items.slice(0, max), `… (+${items.length - max} more)`];
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}