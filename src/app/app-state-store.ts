import { EventBus } from '@/utils/event-bus';
import { APP_STATES, type AppAction, type AppState, type AppStateInfo } from './app-state';

export interface AppStateEvents {
  change: { previous: AppState; current: AppState; info: AppStateInfo };
}

/**
 * Holds the current application state and enforces legal transitions.
 *
 * Transitions are declared per state in `APP_STATES`. An illegal transition is a
 * programming error, so it is logged loudly rather than silently accepted — a silent
 * accept is how interfaces end up claiming a game is running when it is not.
 */
export class AppStateStore {
  readonly events = new EventBus<AppStateEvents>();

  private current: AppState = 'booting';
  private message: string | null = null;

  get state(): AppState {
    return this.current;
  }

  info(): AppStateInfo {
    const definition = APP_STATES[this.current];
    return {
      state: this.current,
      title: definition.title,
      detail: this.message ?? definition.detail,
      actions: definition.actions,
      busy: definition.busy,
    };
  }

  canTransitionTo(next: AppState): boolean {
    return APP_STATES[this.current].next.includes(next);
  }

  /** Move to `next`. Returns false when the transition is not declared. */
  transition(next: AppState, options: { message?: string } = {}): boolean {
    if (next === this.current) {
      if (options.message !== undefined) {
        this.message = options.message;
        this.events.emit('change', { previous: next, current: next, info: this.info() });
      }
      return true;
    }
    if (!this.canTransitionTo(next)) {
      console.error(`[app-state] illegal transition ${this.current} -> ${next}`);
      return false;
    }
    const previous = this.current;
    this.current = next;
    this.message = options.message ?? null;
    this.events.emit('change', { previous, current: next, info: this.info() });
    return true;
  }

  /** Replace the explanation shown for the current state without changing state. */
  setMessage(message: string | null): void {
    this.message = message;
    this.events.emit('change', { previous: this.current, current: this.current, info: this.info() });
  }

  hasAction(action: AppAction): boolean {
    return APP_STATES[this.current].actions.includes(action);
  }

  subscribe(listener: (event: AppStateEvents['change']) => void): () => void {
    return this.events.on('change', listener);
  }
}
