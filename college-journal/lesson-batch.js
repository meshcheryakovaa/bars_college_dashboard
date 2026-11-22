/* Pure queue planner for sequential KTP binding; no access to BARS or browser APIs. */
(() => {
  "use strict";
  const numeric = (value) => /^[1-9]\d{0,3}$/.test(String(value || "").trim());
  const byLesson = (a, b) => {
    const x = Number(a.number), y = Number(b.number);
    if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
    return String(a.date).localeCompare(String(b.date), "ru", {numeric: true});
  };
  function prepare(journal, entries = {}) {
    const lessons = [...(journal?.lessons || [])].sort(byLesson);
    const unique = new Set(lessons.map((lesson) => String(lesson.id)));
    if (lessons.some((lesson) => lesson.id == null || String(lesson.id).trim() === "")
      || unique.size !== lessons.length) {
      throw new Error("Обнаружены отсутствующие или повторяющиеся ID занятий. Обновите сбор журнала.");
    }
    const queue = [], missing = [], unresolved = [], attempted = [], linked = [];
    for (const lesson of lessons) {
      const state = entries[String(lesson.id)] || {};
      if (state.linked) {linked.push(lesson); continue;}
      if (state.bindNeedsReview) {unresolved.push(lesson); continue;}
      if (state.bindAttempted || /^КТП:/.test(state.lastAction || "")) {
        attempted.push(lesson);
        continue;
      }
      if (!numeric(state.ktpNumber)) {missing.push(lesson); continue;}
      queue.push(lesson);
    }
    return {queue, missing, unresolved, attempted, linked, total: lessons.length};
  }
  globalThis.collegeLessonBatch = Object.freeze({prepare});
})();
