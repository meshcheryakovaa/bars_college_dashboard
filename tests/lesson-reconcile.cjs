const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "college-journal");
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(root, "lesson-reconcile.js"), "utf8"), sandbox);
const {reconcile, auditJournal} = sandbox.collegeLessonReconcile;
const page = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(root, "lesson-actions-page.js"), "utf8"), page);
const evaluate = page.window.__barsLessonActions.evaluateGradeValues;

assert.equal(evaluate(["3", "4", "5"]).status, "complete",
  "Existing 4/5 are valid and never overwritten.");
assert.equal(evaluate(["3", "", "4"]).status, "incomplete");
assert.equal(evaluate(["3", null, "5"]).status, "unknown");
assert.equal(evaluate(["3", "н", "5"]).status, "unknown",
  "Do not count attendance or unrecognized values as grades.");
assert.equal(evaluate(["3", "3", "3"]).counts.threes, 3);

const entry = {ktpNumber: "7", bindAttempted: true, gradeAttempted: true,
  closeAttempted: true, closeNeedsReview: true};
const confirmed = reconcile({ok: true, state: {
  ktp: {status: "confirmed", topic: "7"},
  grades: {status: "complete", counts: {total: 3, threes: 1, nonThree: 2}},
  closure: "closed"
}}, entry);
assert.equal(confirmed.issues.length, 0);
assert.equal(confirmed.patch.linked, true);
assert.equal(confirmed.patch.graded, true);
assert.equal(confirmed.patch.closed, true);
assert.equal(confirmed.patch.closeNeedsReview, false);

const unknown = reconcile({ok: true, state: {
  ktp: {status: "unknown", topic: null},
  grades: {status: "unknown"},
  closure: "unknown"
}}, entry);
assert.equal(unknown.patch.linked, undefined);
assert.equal(unknown.patch.closed, undefined);
assert.equal(unknown.safe, false,
  "Unknown response must never be treated as a successful write.");
assert(unknown.issues.length >= 2);

const partiallyGraded = reconcile({ok: true, state: {
  ktp: {status: "confirmed", topic: "7"},
  grades: {status: "incomplete", counts: {total: 3, empty: 1, threes: 1, nonThree: 1}},
  closure: "open"
}}, {ktpNumber: "7", bindAttempted: true, gradeAttempted: true});
assert.equal(partiallyGraded.patch.gradeAttempted, false,
  "After readback proves a missing grade, reapplying only blank cells is safe.");
assert.equal(partiallyGraded.patch.gradeNeedsReview, false);
assert.equal(partiallyGraded.patch.linked, true);

const conflict = reconcile({ok: true, state: {
  ktp: {status: "confirmed", topic: "8"},
  grades: {status: "complete"},
  closure: "open"
}}, entry);
assert.equal(conflict.patch.linked, false);
assert.equal(conflict.safe, false);
assert(conflict.issues.some((x) => x.includes("тема № 8")));

const journal = {
  group: "СП-1-26р - 1 курс", subject: "БД.05 Информатика",
  kind: "practical", lessons: [
    {id: "100", number: 1, date: "12.09"},
    {id: "101", number: 2, date: "19.09"}
  ], students: [{id: "1"}, {id: "2"}]
};
const local = {"100": {ktpNumber: "1"}, "101": {ktpNumber: "2"}};
const remote = {
  group: journal.group, subject: journal.subject, kind: "practical",
  lessonIds: ["100", "101"], studentIds: ["1", "2"]
};
assert.equal(auditJournal(journal, local, remote).ready, true);
assert.equal(auditJournal(journal, local, {...remote, studentIds: ["1", "3"]}).ready, false);
assert(auditJournal(journal, local, {...remote, studentIds: ["1", "3"]}).issues
  .some((x) => x.includes("Состав студентов")));
assert.equal(auditJournal(journal, local, {...remote, lessonIds: ["100"]}).ready, false);
assert.equal(auditJournal(journal, {"100": {ktpNumber: ""}, "101": {ktpNumber: "2"}}, remote).ready, false);
assert.equal(auditJournal(journal, local, {error: "network lost"}).ready, false);

console.log("PASS: independent readbacks, grade 4/5, lost response and whole-journal preflight");
