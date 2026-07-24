/** In-memory per-app log ring. A persistence seam for later; fine for the reference. */
export class LogStore {
  private byApp = new Map<string, string[]>();
  private cap: number;

  constructor(cap = 200) {
    this.cap = cap;
  }

  append(appId: string, entries: string[]): void {
    if (entries.length === 0) return;
    const ts = new Date().toISOString();
    const arr = this.byApp.get(appId) ?? [];
    for (const e of entries) arr.push(`${ts} ${e}`);
    while (arr.length > this.cap) arr.shift();
    this.byApp.set(appId, arr);
  }

  get(appId: string, limit = 100): string[] {
    const arr = this.byApp.get(appId) ?? [];
    return arr.slice(-limit);
  }
}
