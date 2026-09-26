/** In-memory Web Storage for node tests. */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  /** When set, setItem throws (simulates QuotaExceededError) for values longer than this. */
  quota: number | null = null;

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.quota !== null && value.length > this.quota) throw new Error('QuotaExceededError');
    this.map.set(key, String(value));
  }
}
