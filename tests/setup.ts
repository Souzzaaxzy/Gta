import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

/**
 * jsdom ships a `Blob` whose `slice()` result has no `arrayBuffer()` method, which the
 * disc-image code relies on. Node's own `Blob`/`File` implement the full spec, so we
 * install them over jsdom's for the whole test run.
 *
 * This is a test-environment fix, not a production shim: real browsers implement
 * `Blob.prototype.slice().arrayBuffer()`.
 */
const globalWithBlob = globalThis as unknown as { Blob: unknown; File: unknown };
globalWithBlob.Blob = NodeBlob;
globalWithBlob.File = NodeFile;

// jsdom does not implement requestAnimationFrame's timing semantics by default in all
// configurations; provide a microtask-based fallback so rAF-throttled code can be tested.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) => clearTimeout(handle)) as typeof cancelAnimationFrame;
}
