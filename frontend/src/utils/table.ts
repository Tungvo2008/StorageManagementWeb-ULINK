export type SortDir = "asc" | "desc";

export type SortState<K extends string> = {
  key: K;
  dir: SortDir;
};

export function toggleSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (current.key !== key) return { key, dir: "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

function normalizeText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function compareValues(a: unknown, b: unknown): number {
  const an = normalizeNumber(a);
  const bn = normalizeNumber(b);
  if (an != null && bn != null) return an - bn;
  const as = normalizeText(a);
  const bs = normalizeText(b);
  return as.localeCompare(bs);
}

export function sortBy<T>(items: T[], compare: (item: T) => unknown, dir: SortDir): T[] {
  const copied = [...items];
  copied.sort((x, y) => {
    const base = compareValues(compare(x), compare(y));
    return dir === "asc" ? base : -base;
  });
  return copied;
}

export function matchesQuery(query: string, ...values: Array<unknown>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return values.some((v) => normalizeText(v).includes(q));
}
