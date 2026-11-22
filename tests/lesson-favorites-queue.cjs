const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dir = path.join(__dirname, "..", "college-journal");
const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");
const sandbox = {Date};
vm.runInNewContext(read("lesson-batch.js"), sandbox);
const run = sandbox.collegeLessonBatch.runFillDates;
const lessons = [
  {id: "a", number: 1, date: "12.09"},
  {id: "b", number: 2, date: "19.09"},
  {id: "c", number: 3, date: "26.09"}
];

function hooks(trace, opts = {}) {
  return {
    stopOnError: opts.stopOnError,
    stopped: () => Boolean(opts.stopped),
    needed: () => true,
    async perform(lesson, stage) {
      trace.push(stage + ":" + lesson.id);
      if (lesson.id === "b" && stage === opts.failStage) {
        return {ok: true, verified: false, message: "unverified grades"};
      }
      if (opts.fatal && lesson.id === "b" && stage === "bind") {
        return {ok: false, fatal: true, message: "local storage unavailable"};
      }
      return {ok: true, verified: stage === "grades"};
    },
    async verify(lesson, refresh) {
      trace.push((refresh ? "refresh:" : "verify:") + lesson.id);
      return {ok: true, verified: opts.alwaysUnverified ? false :
        lesson.id === "a" ? trace.includes("close:b") :
        lesson.id === "b" ? trace.includes("close:c") : false};
    },
    async progress() {}
  };
}

(async () => {
  const strictTrace = [];
  const strict = await run(lessons, hooks(strictTrace,
    {stopOnError: true, alwaysUnverified: true}));
  assert.equal(strict.processed, 1);
  assert.equal(strictTrace.filter((x) => x.startsWith("close:")).length, 2);
  assert.match(strict.reason, /нет подтверждения|не подтвержден/);

  const looseTrace = [];
  const loose = await run(lessons, hooks(looseTrace,
    {stopOnError: false, alwaysUnverified: true}));
  assert.equal(loose.processed, 3);
  assert.equal(looseTrace.filter((x) => x.startsWith("close:")).length, 3);
  assert.equal(loose.pendingLessons.length, 3);
  assert.equal(loose.issues.length, 3,
    "The same missing confirmation should be counted once per lesson.");
  assert.equal(loose.reason, "");

  const gradingTrace = [];
  const grading = await run(lessons, hooks(gradingTrace,
    {stopOnError: false, failStage: "grades"}));
  assert.equal(grading.skipped, 1);
  assert(!gradingTrace.includes("close:b"), "Do not close failed grading.");
  assert(gradingTrace.includes("bind:c"), "Continue with next date.");

  const fatalTrace = [];
  const fatal = await run(lessons, hooks(fatalTrace,
    {stopOnError: false, fatal: true}));
  assert.match(fatal.reason, /дальнейшая запись остановлена/);
  assert(!fatalTrace.includes("bind:c"),
    "A local persistence failure must stop even when the checkbox is off.");

  const workflow = read("lesson-workflow.js");
  const collector = read("collector.js");
  const html = read("dashboard.html");
  const background = read("background.js");
  const manifest = JSON.parse(read("manifest.json"));
  for (const id of [
    "workflow-stop-errors", "workflow-favorite-list", "workflow-run-queue",
    "workflow-clear-queue", "workflow-queue-results"
  ]) assert(html.includes('id="' + id + '"'), "Missing UI element: " + id);
  assert(workflow.includes('const favoritesKey = "workflow:favorite-journals"'));
  assert(workflow.includes('const stopErrorsKey = "workflow:stop-on-errors"'));
  assert(workflow.includes('await navigateQueueJournal(journal)'));
  assert(workflow.includes('await runFullJournalByDates({fromQueue: true, stopOnError})'));
  assert(workflow.includes('selectedKey = journal.key'));
  assert(workflow.includes('assignFavoriteKtp(journal, start.value)'));
  assert(collector.includes('async function navigateJournal(target, signal)'));
  assert(collector.includes('await openBatchGroup({period: target.period, name: target.group}'));
  assert(collector.includes('pageCommand(current, "select", matches[0])'));
  assert(collector.includes('await applyDates({from: sorted[0], to: sorted[sorted.length - 1]}'));
  assert(collector.includes('message.type === "navigateJournalCancel"'));
  assert(background.includes('key === "workflow:favorite-journals"'));
  assert(background.includes('key === "workflow:stop-on-errors"'));
  assert(!/chrome\.tabs\.update\s*\(|chrome\.windows\.update\s*\(/.test(workflow));
  assert.equal(manifest.version, "1.12.0");

  console.log("PASS: strict/tolerant modes, safe stage skipping, favorites and navigation");
})().catch((error) => {console.error(error); process.exitCode = 1;});
