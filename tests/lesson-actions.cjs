const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "college-journal", "lesson-actions-page.js"), "utf8");
const workflow = fs.readFileSync(path.join(__dirname, "..", "college-journal", "lesson-workflow.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "college-journal", "dashboard.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "college-journal", "manifest.json"), "utf8"));
assert.equal(manifest.version, "1.10.0");
assert(!/\bfetch\s*\(|new\s+XMLHttpRequest|Ext\.Ajax\.request/.test(source),
  "Page automation must not send direct requests");
assert(html.includes('src="lesson-actions-page.js"') === false,
  "MAIN-world bridge must only be injected for an explicit action");
assert(html.includes('src="lesson-workflow.js"'));
for (const name of ["workflow-stop", "workflow-rows", "workflow-journal", "workflow-number-all"]) {
  assert(html.includes('id="' + name + '"'));
}
for (const action of ['"bind"', '"grades"', '"close"', '"check"']) {
  assert(source.includes(action), "Missing action " + action);
}
assert(workflow.includes('world: "MAIN"'));
assert(workflow.includes('studentIds: journal.students.map'));
const window = {};
const context = {
  window,
  document: {querySelectorAll: () => []},
  location: {origin: "https://college.72to.ru"},
  setTimeout
};
vm.runInNewContext(source, context, {filename: "lesson-actions-page.js"});
assert.equal(window.__barsLessonActions.version, 3);

(async () => {
  const badOrigin = await window.__barsLessonActions.run({
    origin: "https://other.example", action: "close"
  });
  assert.equal(badOrigin.ok, false);
  assert.match(badOrigin.message, /другая образовательная система/);
  const noJournal = await window.__barsLessonActions.run({
    origin: "https://college.72to.ru", action: "grades"
  });
  assert.equal(noJournal.ok, false);
  assert.match(noJournal.message, /нужный тип журнала/);
  process.stdout.write("Lesson workflow static and fail-closed checks passed.\n");
})().catch((error) => {console.error(error); process.exitCode = 1;});
