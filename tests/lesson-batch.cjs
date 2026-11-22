const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extension = path.join(__dirname, "..", "college-journal");
const read = (name) => fs.readFileSync(path.join(extension, name), "utf8");

const sandbox = {};
vm.runInNewContext(read("lesson-batch.js"), sandbox);
const prepare = sandbox.collegeLessonBatch.prepare;
const journal = {
  lessons: [
    {id: "lesson-4", number: "4", date: "29.10"},
    {id: "lesson-2", number: "2", date: "12.09"},
    {id: "lesson-1", number: "1", date: "12.09"},
    {id: "lesson-3", number: "3", date: "29.10"}
  ]
};
const complete = prepare(journal, {
  "lesson-1": {ktpNumber: "1"},
  "lesson-2": {ktpNumber: "2"},
  "lesson-3": {ktpNumber: "3"},
  "lesson-4": {ktpNumber: "4"}
});
assert.equal(complete.total, 4);
assert.deepEqual(Array.from(complete.queue, (item) => item.id),
  ["lesson-1", "lesson-2", "lesson-3", "lesson-4"],
  "Binding order must follow lesson number even for repeated dates.");
assert.equal(complete.missing.length, 0);

const partial = prepare(journal, {
  "lesson-1": {ktpNumber: "1", linked: true},
  "lesson-2": {ktpNumber: "2", bindAttempted: true},
  "lesson-3": {ktpNumber: "3", bindNeedsReview: true},
  "lesson-4": {ktpNumber: ""}
});
assert.deepEqual(Array.from(partial.queue), []);
assert.equal(partial.linked.length, 1);
assert.equal(partial.attempted.length, 1);
assert.equal(partial.unresolved.length, 1);
assert.equal(partial.missing.length, 1);
assert.equal(prepare(journal, {
  "lesson-1": {linked: true}, "lesson-2": {lastAction: "КТП: требует проверки"}
}).attempted.length, 1, "Legacy successful KTP request must not be repeated.");

// Mass grading: process only unfinished, unclosed lessons, do not repeat
// requests with unknown results, and keep order even for repeated dates.
const grades = sandbox.collegeLessonBatch.prepareGrades(journal, {
  "lesson-1": {graded: true},
  "lesson-2": {gradeAttempted: true},
  "lesson-3": {gradeNeedsReview: true},
  "lesson-4": {}
});
assert.deepEqual(Array.from(grades.queue, (item) => item.id), ["lesson-4"]);
assert.equal(grades.completed.length, 1);
assert.equal(grades.attempted.length, 1);
assert.equal(grades.unresolved.length, 1);
assert.equal(grades.total, 4);
assert.equal(sandbox.collegeLessonBatch.prepareGrades(journal, {
  "lesson-1": {closed: true},
  "lesson-2": {lastAction: "Оценки: требует проверки"}
}).closed.length, 1);
assert.equal(sandbox.collegeLessonBatch.prepareGrades(journal, {
  "lesson-2": {lastAction: "Оценки: требует проверки"}
}).attempted.length, 1);

// Mass closing: a lesson is eligible only when KTP and grades are confirmed.
const closing = sandbox.collegeLessonBatch.prepareClose(journal, {
  "lesson-1": {closed: true},
  "lesson-2": {linked: true, graded: true},
  "lesson-3": {linked: true, graded: false},
  "lesson-4": {linked: false, graded: true}
});
assert.deepEqual(Array.from(closing.queue, (item) => item.id), ["lesson-2"]);
assert.equal(closing.completed.length, 1);
assert.equal(closing.blocked.length, 2);
assert.equal(closing.blocked[0].needsGrades, true);
assert.equal(closing.blocked[1].needsKtp, true);
assert.equal(sandbox.collegeLessonBatch.prepareClose(journal, {
  "lesson-1": {closeNeedsReview: true},
  "lesson-2": {closeAttempted: true}
}).unresolved.length, 1);
assert.equal(sandbox.collegeLessonBatch.prepareClose(journal, {
  "lesson-2": {lastAction: "Закрытие: требует проверки"}
}).attempted.length, 1);
assert.throws(() => sandbox.collegeLessonBatch.prepareGrades({
  lessons: [{id: "dup"}, {id: "dup"}]
}, {}), /повторяющиеся ID/);
assert.throws(() => sandbox.collegeLessonBatch.prepareClose({
  lessons: [{id: ""}]
}, {}), /отсутствующие или повторяющиеся ID/);


assert.throws(() => prepare({lessons: [{id: "a"}, {id: "a"}]}, {}),
  /повторяющиеся ID занятий/);
assert.throws(() => prepare({lessons: [{number: "1"}]}, {}),
  /отсутствующие или повторяющиеся ID/);

const dashboard = read("lesson-workflow.js");
const page = read("dashboard.html");
const manifest = JSON.parse(read("manifest.json"));
assert(!/chrome\.tabs\.update\s*\(|chrome\.windows\.update\s*\(/.test(dashboard),
  "Lesson actions must never activate or focus the source tab.");
assert(page.includes('src="lesson-batch.js"'));
assert(page.indexOf('src="lesson-batch.js"') < page.indexOf('src="lesson-workflow.js"'));
assert(page.includes('id="workflow-bind-all"'));
assert(page.includes('id="workflow-batch-progress"'));
assert(page.includes('id="workflow-stop"'));
assert(page.includes('id="workflow-grades-all"'));
assert(page.includes('id="workflow-close-all"'));
assert(dashboard.includes('runBatchWrite("grades")'));
assert(dashboard.includes('runBatchWrite("close")'));
assert(dashboard.includes('gradeNeedsReview: true'));
assert(dashboard.includes('closeNeedsReview: true'));
assert(dashboard.includes('if (!result.verified)'));

assert.equal(manifest.version, "1.9.0");
assert.deepEqual(Array.from(manifest.host_permissions), ["https://college.72to.ru/*"]);
console.log("PASS: serial KTP, grades, close planning, preflight and background-tab UI.");
