import assert from "node:assert/strict";
import { test } from "node:test";
import { startVisiblePolling } from "../src/visible-polling.js";

function environment() {
  let visible = true;
  let next = 0;
  let listener: (() => void) | undefined;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  return {
    timers,
    hide() { visible = false; listener?.(); },
    show() { visible = true; listener?.(); },
    async tick() {
      const entry = timers.entries().next().value;
      assert(entry, "expected a pending poll");
      timers.delete(entry[0]); entry[1].callback();
      await new Promise<void>(resolve => setImmediate(resolve));
    },
    settings: {
      visible: () => visible,
      onVisibility: (callback: () => void) => { listener = callback; return () => { listener = undefined; }; },
      schedule: (callback: () => void, delay: number) => {
        const id = ++next; timers.set(id, { callback, delay });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: (id: ReturnType<typeof setTimeout>) => { timers.delete(id as unknown as number); },
    },
  };
}

test("studio polling backs off, pauses hidden tabs and refreshes on return", async () => {
  const env = environment();
  let calls = 0;
  const stop = startVisiblePolling(async () => { calls++; }, env.settings);
  for (const delay of [2000, 4000, 8000, 15000]) {
    assert.equal([...env.timers.values()][0].delay, delay);
    await env.tick();
  }
  assert.equal(calls, 4);
  env.hide();
  assert.equal(env.timers.size, 0);
  env.show();
  assert.equal([...env.timers.values()][0].delay, 0);
  await env.tick();
  assert.equal(calls, 5);
  stop();
  env.hide(); env.show();
  assert.equal(env.timers.size, 0);
});

test("pending polls never overlap or restart after unmount", async () => {
  const env = environment();
  let resolve: (() => void) | undefined;
  let calls = 0;
  const stop = startVisiblePolling(() => {
    calls++;
    return new Promise<void>(done => { resolve = done; });
  }, env.settings);
  await env.tick();
  env.hide(); env.show();
  assert.equal(calls, 1);
  assert.equal(env.timers.size, 0);
  stop(); resolve?.();
  await new Promise<void>(done => setImmediate(done));
  assert.equal(env.timers.size, 0);
});

test("a temporary polling error can recover without an unhandled rejection", async () => {
  const env = environment();
  let calls = 0;
  const stop = startVisiblePolling(async () => { if (++calls === 1) throw new Error("offline"); }, env.settings);
  await env.tick(); await env.tick();
  assert.equal(calls, 2);
  stop();
});
