import { describe, expect, it } from 'vitest';
import { AppStateStore } from '@/app/app-state-store';
import { APP_STATES, isInteractive, type AppState } from '@/app/app-state';

describe('APP_STATES', () => {
  it('declares only transitions to known states', () => {
    const known = new Set(Object.keys(APP_STATES));
    for (const [name, definition] of Object.entries(APP_STATES)) {
      for (const next of definition.next) {
        expect(known.has(next), `${name} -> ${next}`).toBe(true);
      }
    }
  });

  it('gives every state a title and a detail', () => {
    for (const definition of Object.values(APP_STATES)) {
      expect(definition.title.length).toBeGreaterThan(0);
      expect(definition.detail.length).toBeGreaterThan(0);
    }
  });

  it('marks only running and starting-game as interactive', () => {
    expect(isInteractive('running')).toBe(true);
    expect(isInteractive('starting-game')).toBe(true);
    expect(isInteractive('paused')).toBe(false);
    expect(isInteractive('awaiting-files')).toBe(false);
  });
});

describe('AppStateStore', () => {
  it('starts in booting', () => {
    const store = new AppStateStore();
    expect(store.state).toBe('booting');
    expect(store.info().busy).toBe(true);
  });

  it('allows a declared transition', () => {
    const store = new AppStateStore();
    expect(store.transition('awaiting-files')).toBe(true);
    expect(store.state).toBe('awaiting-files');
  });

  it('refuses an undeclared transition and keeps the current state', () => {
    const store = new AppStateStore();
    store.transition('awaiting-files');
    // awaiting-files cannot go straight to running.
    expect(store.transition('running')).toBe(false);
    expect(store.state).toBe('awaiting-files');
  });

  it('walks the real boot path', () => {
    const store = new AppStateStore();
    const path: AppState[] = ['awaiting-files', 'verifying', 'loading-core', 'initializing', 'starting-game', 'running'];
    for (const state of path) {
      expect(store.transition(state), `transition to ${state}`).toBe(true);
    }
    expect(store.state).toBe('running');
  });

  it('walks the pause and save path', () => {
    const store = new AppStateStore();
    for (const state of ['awaiting-files', 'verifying', 'loading-core', 'initializing', 'starting-game', 'running'] as AppState[]) {
      store.transition(state);
    }
    expect(store.transition('paused')).toBe(true);
    expect(store.transition('running')).toBe(true);
    expect(store.transition('saving')).toBe(true);
    expect(store.transition('running')).toBe(true);
  });

  it('reports the actions available in each state', () => {
    const store = new AppStateStore();
    store.transition('awaiting-files');
    expect(store.hasAction('choose-file')).toBe(true);
    expect(store.hasAction('pause')).toBe(false);
  });

  it('emits a change event with the previous and current state', () => {
    const store = new AppStateStore();
    const events: Array<{ previous: AppState; current: AppState }> = [];
    store.subscribe((event) => events.push({ previous: event.previous, current: event.current }));
    store.transition('awaiting-files');
    expect(events).toEqual([{ previous: 'booting', current: 'awaiting-files' }]);
  });

  it('overrides the detail message without changing state', () => {
    const store = new AppStateStore();
    store.transition('awaiting-files');
    store.setMessage('Disco pronto: san-andreas.iso.');
    expect(store.state).toBe('awaiting-files');
    expect(store.info().detail).toBe('Disco pronto: san-andreas.iso.');
  });

  it('never reaches running without a disc being verified', () => {
    const store = new AppStateStore();
    expect(store.canTransitionTo('running')).toBe(false);
    expect(store.transition('running')).toBe(false);
    expect(store.state).toBe('booting');
  });
});
