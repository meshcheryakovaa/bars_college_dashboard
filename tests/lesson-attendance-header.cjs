const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Fixture mirrors the two-row Ext JS header:
// (2) - 29.10, (3) - 29.10
// hidden lesson ID → visible «Пос» → hidden score column.
const source = fs.readFileSync(
  path.join(__dirname, "..", "college-journal", "lesson-actions-page.js"), "utf8"
);
const instrumented = source.replace(/\}\)\(\);\s*$/,
  '  window.__testAttendanceHeader = attendanceHeader;\n  window.__testSelectLesson = selectLesson;\n})();');
assert.notEqual(instrumented, source, "Test helper was not injected");

const received = [];
function cell(id, text, visible = true) {
  return {
    classList: ["x-grid3-hd", "x-grid3-cell", "x-grid3-td-" + id],
    textContent: text,
    isConnected: true,
    getClientRects: () => visible ? [{}] : [],
    scrollIntoView: () => received.push("scroll:" + id),
    dispatchEvent: (event) => {received.push(id + ":" + event.type); return true;}
  };
}
const d1 = cell("lesson-one", "(2) - 29.10");
const d2 = cell("lesson-two", "(3) - 29.10");
const pos1 = cell("attendance-one", "Пос");
const pos2 = cell("attendance-two", "Пос");
const hidden1 = cell("lesson-one", "None", false);
const hidden2 = cell("lesson-two", "None", false);
const leaves = [
  hidden1, pos1, cell("grade-one", "None", false),
  hidden2, pos2, cell("grade-two", "None", false)
];
const info = {
  right: {querySelectorAll: () => leaves},
  headers: [d1, d2], header: d2,
  lessonKey: "x-grid3-td-lesson-two"
};
const win = {};
const context = {
  window: win,
  document: {querySelectorAll: () => []},
  location: {origin: "https://college.72to.ru"},
  MouseEvent: class {constructor(type) {this.type = type;}},
  setTimeout
};
vm.runInNewContext(instrumented, context, {filename: "lesson-actions-page.js"});
assert.equal(win.__testAttendanceHeader(info), pos2,
  "The second lesson must select its own Пос despite identical date.");
win.__testSelectLesson(info);
assert.deepEqual(received, [
  "scroll:attendance-two", "attendance-two:mousedown",
  "attendance-two:mouseup", "attendance-two:click"
], "Toolbar selection must click the attendance subheader, not the date.");

const wrong = {...info, lessonKey: "x-grid3-td-unknown"};
assert.throws(() => win.__testAttendanceHeader(wrong), /скрытый заголовок ID/);

const ambiguous = {
  ...info,
  right: {querySelectorAll: () => [...leaves, cell("duplicate", "Пос")]}
};
assert.throws(() => win.__testAttendanceHeader(ambiguous), /единственный заголовок «Пос»/);

const missing = {
  ...info,
  right: {querySelectorAll: () =>
    [hidden1, pos1, cell("grade-one", "None", false), hidden2,
      cell("attendance-two", "Оц"), cell("grade-two", "None", false)]}
};
assert.throws(() => win.__testAttendanceHeader(missing), /единственный заголовок «Пос»/);
console.log("PASS: Пос is selected by lesson ID; repeated dates and failure cases are handled.");
