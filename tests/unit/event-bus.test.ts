import { describe, expect, it } from 'vitest';
import { EventBus } from '@/utils/event-bus';

interface Events {
  ping: number;
  pong: { text: string };
}

describe('EventBus', () => {
  it('delivers payloads to subscribers', () => {
    const bus = new EventBus<Events>();
    const seen: number[] = [];
    bus.on('ping', (value) => seen.push(value));
    bus.emit('ping', 1);
    bus.emit('ping', 2);
    expect(seen).toEqual([1, 2]);
  });

  it('unsubscribes through the returned disposer', () => {
    const bus = new EventBus<Events>();
    let count = 0;
    const off = bus.on('ping', () => count++);
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(count).toBe(1);
  });

  it('fires once() listeners exactly once', () => {
    const bus = new EventBus<Events>();
    let count = 0;
    bus.once('ping', () => count++);
    bus.emit('ping', 1);
    bus.emit('ping', 2);
    expect(count).toBe(1);
  });

  it('does not deliver to a listener of another event', () => {
    const bus = new EventBus<Events>();
    let count = 0;
    bus.on('pong', () => count++);
    bus.emit('ping', 1);
    expect(count).toBe(0);
  });

  it('keeps dispatching when one listener throws', () => {
    const bus = new EventBus<Events>();
    const seen: number[] = [];
    bus.on('ping', () => {
      throw new Error('boom');
    });
    bus.on('ping', (value) => seen.push(value));
    expect(() => bus.emit('ping', 7)).not.toThrow();
    expect(seen).toEqual([7]);
  });

  it('allows a listener to unsubscribe during dispatch', () => {
    const bus = new EventBus<Events>();
    const seen: number[] = [];
    const off = bus.on('ping', (value) => {
      seen.push(value);
      off();
    });
    bus.emit('ping', 1);
    bus.emit('ping', 2);
    expect(seen).toEqual([1]);
  });
});
