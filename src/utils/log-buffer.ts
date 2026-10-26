/**
 * Console/log ring buffer. Keeps the last N emulator messages so the interface can show
 * them without unbounded memory growth (Play! prints a lot during boot).
 */
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  at: number;
}

const MAX_ENTRIES = 400;

export class LogBuffer {
  private readonly entries: LogEntry[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();

  push(level: LogLevel, message: string): void {
    const entry: LogEntry = { level, message, at: Date.now() };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    for (const listener of this.listeners) listener(entry);
  }

  info(message: string): void {
    this.push('info', message);
  }

  warn(message: string): void {
    this.push('warn', message);
  }

  error(message: string): void {
    this.push('error', message);
  }

  all(): readonly LogEntry[] {
    return this.entries;
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.entries.length = 0;
  }
}
