const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "college-journal");
const workflow = fs.readFileSync(path.join(root, "lesson-workflow.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

function section(from, to) {
  const first = workflow.indexOf(from);
  const next = workflow.indexOf(to, first + from.length);
  assert(first >= 0 && next > first, "Missing handler boundaries: " + from);
  return workflow.slice(first, next);
}

const bind = section("async function runBatchBinding()", "async function runBatchDelayedClose(");
const close = section("async function runBatchWrite(action)", "async function runFullJournalByDates(");
assert(!/\bgrading\b/.test(bind), "KTP batch must not use undefined grading");
assert(!/\bpriorPending\b/.test(bind), "KTP batch must not use close-only pending state");
assert(!/\brunBatchDelayedClose\s*\(/.test(bind),
  "KTP batch must not call closing");
assert(bind.includes('executeLessonOperation(journal, lesson, "bind")'),
  "KTP batch must still bind topics");
assert(close.includes('const grading = action === "grades";'),
  "Close/grades mode selector must be locally declared");
assert.match(close, /if\s*\(!grading\)\s*\{\s*await\s+runBatchDelayedClose\(journal,\s*plan,\s*label,\s*priorPending\)/,
  "Closing must be dispatched to delayed close pipeline");
assert(close.includes("prepareClose(journal, plans)"),
  "Closing must still use preflight checks");
for (const phrase of [
  'runBatchBinding().catch(',
  'runBatchWrite("grades").catch(',
  'runBatchWrite("close").catch(',
  'runFullJournalByDates().catch('
]) {
  assert(workflow.includes(phrase), "Unexpected promise must be shown in status: " + phrase);
}
assert(!/chrome\.tabs\.update\s*\(|chrome\.windows\.update\s*\(/.test(workflow),
  "Operations must not switch tabs");
assert.equal(manifest.version, "1.12.0");
console.log("PASS: no undefined grading in KTP batch; delayed close routing restored; async errors caught");
