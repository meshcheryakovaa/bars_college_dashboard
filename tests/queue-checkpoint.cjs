const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const code = fs.readFileSync(path.join(__dirname, "..", "college-journal",
  "queue-checkpoint.js"), "utf8");
const sandbox = {};
vm.runInNewContext(code, sandbox);
const {persist, nextCheckpoint} = sandbox.collegeQueueCheckpoint;
const key = "workflow:queue-checkpoint";

(async () => {
  let count = 0;
  const durable = new Map();
  const store = {async set(values) {
    count++;
    // Simulate storage failing precisely between journal A and journal B.
    if (count === 3) throw new Error("storage quota exceeded");
    for (const [k, v] of Object.entries(values)) durable.set(k, v);
  }};
  const first = await persist(store, key, null, {
    status: "running", currentIndex: 0, stage: "navigate",
    journalIds: ["a", "b"], log: []
  }, "2026-11-22T18:00:00Z");
  const afterA = await persist(store, key, first, {
    currentIndex: 1, currentJournal: "a", stage: "journal-finished",
    log: [{journal: "a", processed: 4, issues: 0}]
  }, "2026-11-22T18:01:00Z");
  assert.equal(afterA.currentIndex, 1);
  assert.equal(durable.get(key).currentIndex, 1);
  await assert.rejects(() => persist(store, key, afterA, {
    currentIndex: 1, currentJournal: "b", stage: "navigate"
  }, "2026-11-22T18:02:00Z"), /storage quota exceeded/);
  assert.equal(durable.get(key).currentIndex, 1);
  assert.equal(durable.get(key).stage, "journal-finished",
    "An error between journals must not falsely advance durable progress.");
  assert.equal(afterA.stage, "journal-finished",
    "A failed checkpoint save must not mutate previous in-memory progress.");
  const resumed = nextCheckpoint(durable.get(key), {
    status: "interrupted", currentIndex: 1, stage: "preflight"
  }, "2026-11-22T18:03:00Z");
  assert.equal(resumed.currentIndex, 1);
  assert.equal(resumed.log.length, 1);
  assert.equal(resumed.journalIds.length, 2);
  console.log("PASS: atomic checkpoint, storage failure between journals, safe resume index");
})().catch((error) => {console.error(error); process.exitCode = 1;});
