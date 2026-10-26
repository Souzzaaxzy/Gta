/**
 * Minimal typed event bus. Used to decouple subsystems (emulator, controls, storage, UI)
 * so no module reaches into another's internals.
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<Events> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const dispose = this.on(event, (payload) => {
      dispose();
      listener(payload);
    });
    return dispose;
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy so a listener may unsubscribe during dispatch.
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        console.error(`[event-bus] listener for "${String(event)}" threw`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
