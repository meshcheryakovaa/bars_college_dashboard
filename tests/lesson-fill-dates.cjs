const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(
  path.join(__dirname, "..", "college-journal", "lesson-batch.js"), "utf8");
const context = {Date};
vm.runInNewContext(script, context);
const {lessonsByDate, assignKtpSequence, prepareFull, runFillDates} =
  context.collegeLessonBatch;

const journal = {period: "2026-2027", lessons: [
  {id: "may", date: "02.05", number: "4"},
  {id: "sep2", date: "29.09", number: "2"},
  {id: "jan", date: "06.01", number: "3"},
  {id: "sep1", date: "29.09", number: "1"}
]};
const seq = assignKtpSequence(journal, "7");
assert.deepEqual(Array.from(seq, (item) => item.lesson.id),
  ["sep1", "sep2", "jan", "may"]);
assert.deepEqual(Array.from(seq, (item) => item.ktpNumber),
  ["7", "8", "9", "10"]);
assert.equal(lessonsByDate(journal).length, 4);
assert.throws(() => assignKtpSequence(journal, "9998"), /пределы 9999/);
assert.throws(() => assignKtpSequence(journal, "0"), /целое число/);
assert.throws(() => lessonsByDate({
  period: "2026-2027", lessons: [{id: "broken", date: "31.02", number: 1}]
}), /Некорректная дата/);
const entries = Object.fromEntries(seq.map(({lesson, ktpNumber}) =>
  [lesson.id, {ktpNumber}]));
assert.equal(prepareFull(journal, entries).queue.length, 4);
assert.equal(prepareFull(journal, {
  ...entries, sep1: {...entries.sep1, closed: true}
}).completed.length, 1);
assert.match(prepareFull(journal, {
  ...entries, sep1: {...entries.sep1, bindAttempted: true}
}).problems[0].reason, /привязка/);
assert.match(prepareFull(journal, {
  ...entries, sep1: {...entries.sep1, gradeAttempted: true}
}).problems[0].reason, /оценки/);
assert.match(prepareFull(journal, {
  ...entries, sep1: {...entries.sep1, closeNeedsReview: true}
}).problems[0].reason, /закрытие/);

const ordered = seq.slice(0, 3).map((row) => row.lesson);
function hooks(trace, options = {}) {
  const closed = new Set();
  const pending = new Set();
  let count = 0;
  return {
    stopped: () => false,
    needed: (lesson, stage) => !closed.has(lesson.id + ":" + stage),
    async perform(lesson, stage) {
      trace.push(stage + ":" + lesson.id);
      if (options.gradeFail && stage === "grades" && lesson.id === "sep2")
        return {ok: true, verified: false, message: "оценка не подтверждена"};
      if (stage === "close") {pending.add(lesson.id);count++;}
      closed.add(lesson.id + ":" + stage);
      return {ok: true, verified: stage === "grades"};
    },
    async verify(lesson, final) {
      trace.push((final ? "refresh:" : "verify:") + lesson.id);
      if (options.refreshError && final)
        return {ok: false, verified: false, message: "ошибка обновления"};
      const index = ordered.findIndex((x) => x.id === lesson.id);
      const hasFollowingClose = [...pending].some((x) =>
        ordered.findIndex((row) => row.id === x) > index);
      const verified = hasFollowingClose || Boolean(options.finalVisible);
      if (verified) pending.delete(lesson.id);
      return {ok: true, verified};
    },
    async progress() {}
  };
}
(async () => {
  const trace = [];
  const result = await runFillDates(ordered, hooks(trace));
  assert.equal(result.processed, 3);
  assert.equal(result.verifiedClose, 2);
  assert.equal(result.pending.id, "jan");
  assert.equal(result.reason, "");
  assert.deepEqual(trace.filter((x) => x.startsWith("close:")),
    ["close:sep1", "close:sep2", "close:jan"]);
  assert.deepEqual(trace.filter((x) => x.startsWith("refresh:")),
    ["refresh:sep1", "refresh:sep2", "refresh:jan", "refresh:jan"]);
  assert.deepEqual(trace.filter((x) => x.startsWith("verify:")),
    ["verify:sep1", "verify:sep2"]);
  assert(trace.indexOf("bind:sep2") > trace.indexOf("refresh:sep1"),
    "Next date must start after previous close and refresh.");
  const doneTrace = [];
  const done = await runFillDates(ordered, hooks(doneTrace, {finalVisible: true}));
  assert.equal(done.verifiedClose, 3);
  assert.equal(done.pending, null);
  const failTrace = [];
  const failed = await runFillDates(ordered, hooks(failTrace, {gradeFail: true}));
  assert.equal(failed.processed, 1);
  assert.match(failed.reason, /оценки/);
  assert(!failTrace.includes("close:sep2"));
  assert(!failTrace.includes("bind:jan"));
  const refreshTrace = [];
  const refreshing = await runFillDates(ordered, hooks(refreshTrace, {refreshError: true}));
  assert.equal(refreshing.processed, 0);
  assert.match(refreshing.reason, /Не удалось обновить/);
  assert(!refreshTrace.includes("bind:sep2"));
  console.log("PASS: chronological +1 KTP, per-date flow, refresh, delayed closure and fail-closed");
})().catch((error) => {console.error(error);process.exitCode=1;});
