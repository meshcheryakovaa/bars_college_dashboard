const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const filename = path.join(__dirname, "..", "college-journal", "lesson-batch.js");
const source = fs.readFileSync(filename, "utf8");
const sandbox = {};
vm.runInNewContext(source, sandbox);
const run = sandbox.collegeLessonBatch.runDelayedClose;
const lessons = [{id: "a", number: 1}, {id: "b", number: 2}, {id: "c", number: 3}];
const hooks = (trace, overrides = {}) => ({
  stopped: () => false,
  beforeSubmit: async (item) => {trace.push("intent:" + item.id); return true;},
  submit: async (item) => {trace.push("close:" + item.id); return {ok: true, verified: false};},
  onSubmitted: async (item) => {trace.push("stored:" + item.id); return true;},
  verify: async (item, final) => {
    trace.push((final ? "refresh:" : "verify:") + item.id);
    return {ok: true, verified: true};
  },
  onVerified: async (item) => {trace.push("confirmed:" + item.id); return true;},
  onUnverified: async (item) => {trace.push("pending:" + item.id); return true;},
  onError: async (item) => {trace.push("error:" + item.id);},
  progress: async ({submitted, verified}) => {trace.push("progress:" + submitted + "/" + verified);},
  ...overrides
});

(async () => {
  const trace = [];
  const result = await run(lessons, hooks(trace));
  assert.equal(result.submitted, 3);
  assert.equal(result.verified, 3);
  assert.equal(result.pending, null);
  assert.equal(result.reason, "");
  assert.deepEqual(trace, [
    "intent:a", "close:a", "stored:a", "progress:1/0",
    "intent:b", "close:b", "stored:b", "verify:a", "confirmed:a", "progress:2/1",
    "intent:c", "close:c", "stored:c", "verify:b", "confirmed:b", "progress:3/2",
    "refresh:c", "confirmed:c"
  ]);

  const last = [];
  const lastPending = await run(lessons, hooks(last, {
    verify: async (item, final) => {
      last.push((final ? "refresh:" : "verify:") + item.id);
      return {ok: true, verified: !final};
    }
  }));
  assert.equal(lastPending.submitted, 3);
  assert.equal(lastPending.verified, 2);
  assert.equal(lastPending.pending.id, "c");
  assert(!last.some((event) => event === "close:c" && last.indexOf(event) !== last.lastIndexOf(event)),
    "A pending final lesson must never be closed twice.");

  const fail = [];
  const partial = await run(lessons, hooks(fail, {
    verify: async (item, final) => {
      fail.push((final ? "refresh:" : "verify:") + item.id);
      return {ok: true, verified: false, message: "not yet visible"};
    }
  }));
  assert.equal(partial.submitted, 2);
  assert.equal(partial.verified, 0);
  assert(partial.reason.includes("Не подтверждено предыдущее занятие"));
  assert(!fail.includes("close:c"), "Do not close the next lesson when prior confirmation fails.");

  // Восстановление после старой версии: занятие A уже было отправлено,
  // закрываем B, затем проверяем A без повторной отправки закрытия A.
  const resumedLog = [];
  const resumed = await run([lessons[1], lessons[2]], hooks(resumedLog, {
    initialPending: lessons[0]
  }));
  assert.equal(resumed.submitted, 2);
  assert.equal(resumed.verified, 3);
  assert.equal(resumed.pending, null);
  assert.deepEqual(resumedLog.filter((v) => v.startsWith("close:")), ["close:b", "close:c"]);
  assert.deepEqual(resumedLog.filter((v) => v.startsWith("verify:") || v.startsWith("refresh:")),
    ["verify:a", "verify:b", "refresh:c"]);
  const prepareClose = sandbox.collegeLessonBatch.prepareClose;
  const resumeState = {
    "a": {closeAttempted: true, closeNeedsReview: true, lastAction: "Закрытие: требует проверки",
      linked: true, graded: true},
    "b": {linked: true, graded: true},
    "c": {linked: true, graded: true}
  };
  const resumePlan = prepareClose({lessons}, resumeState);
  assert.equal(sandbox.collegeLessonBatch.resumableClose(resumePlan, resumeState).id, "a");
  assert.equal(sandbox.collegeLessonBatch.resumableClose(resumePlan, {
    ...resumeState, a: {...resumeState.a, lastAction: "Закрытие: неизвестный результат"}
  }), null, "Cannot resume a request that failed without confirmation it was submitted.");
  assert.equal(sandbox.collegeLessonBatch.resumableClose(resumePlan, {
    ...resumeState, a: {...resumeState.a, closeAttempted: false}
  }), null);
  assert.equal(sandbox.collegeLessonBatch.resumableClose({
    ...resumePlan, blocked: [{lesson: lessons[1]}]
  }, resumeState), null);

  const manual = [];
  const stopped = await run(lessons, hooks(manual, {stopped: () => manual.includes("confirmed:a")}));
  assert.equal(stopped.submitted, 2);
  assert.equal(stopped.verified, 1);
  assert.equal(stopped.pending.id, "b");
  assert(!manual.includes("close:c"));

  console.log("PASS: delayed close order, last refresh, pending/stop/no repeat");
})().catch((error) => {console.error(error); process.exitCode = 1;});
