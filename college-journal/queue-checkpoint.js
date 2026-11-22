/* Pure checkpoint transition and durable-write adapter, shared with Node tests. */
(() => {
  "use strict";
  function nextCheckpoint(previous, patch, now) {
    return {
      version: 1,
      ...(previous || {}),
      ...patch,
      updatedAt: now || new Date().toISOString()
    };
  }
  async function persist(store, key, previous, patch, now) {
    const next = nextCheckpoint(previous, patch, now);
    // Never mutate the in-memory checkpoint until durable storage succeeds.
    await store.set({[key]: JSON.parse(JSON.stringify(next))});
    return next;
  }
  globalThis.collegeQueueCheckpoint = Object.freeze({nextCheckpoint, persist});
})();
