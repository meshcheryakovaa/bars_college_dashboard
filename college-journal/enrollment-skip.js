/* Pure parser and per-lesson enrollment exceptions. */
(() => {
  "use strict";
  const norm = (text) => String(text ?? "").replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ").trim();
  const same = (a, b) => norm(a).toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е") === norm(b).toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const group = (s) => norm(s).replace(/\s*[-–—]\s*\d+\s+курс\s*$/i, "");
  function parseWarning(text) {
    const t = norm(text).replace(/[.!]\s*$/, "");
    const m = /^На\s+(\d{1,2}\.\d{1,2}\.\d{4})\s+студент\s+(.+?)\s+не\s+числится\s+в\s+группе\s+(.+)$/i.exec(t);
    return m ? {date: m[1], student: norm(m[2]), group: norm(m[3])} : null;
  }
  function fullDate(date, period) {
    const raw = norm(date);
    if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(raw)) return raw;
    const m = /^(\d{1,2})\.(\d{1,2})$/.exec(raw);
    const p = /^(\d{4})\s*[-/]\s*(\d{4})$/.exec(norm(period));
    if (!m || !p) return null;
    return [m[1].padStart(2, "0"), m[2].padStart(2, "0"),
      Number(m[2]) >= 9 ? p[1] : p[2]].join(".");
  }
  function matchWarning(text, task, studentName) {
    const data = parseWarning(text);
    if (!data || !same(group(data.group), group(task.group)) ||
      !same(data.student, studentName)) return false;
    const expectedDate = fullDate(task.date, task.period);
    return expectedDate !== null && same(data.date, expectedDate);
  }
  function validSkip(skip, task, studentId) {
    return Boolean(skip && skip.reason === "not-enrolled-on-lesson-date" &&
      String(skip.lessonId) === String(task.lessonId) &&
      String(skip.studentId) === String(studentId) &&
      same(skip.lessonDate, fullDate(task.date, task.period)) &&
      skip.checkedAt && matchWarning(skip.warning, task, skip.studentName));
  }
  function evaluate(values, studentIds, skips = {}, task = {}) {
    if (!Array.isArray(values) || !values.length || values.some(v => v == null) ||
      !Array.isArray(studentIds) || studentIds.length !== values.length)
      return {status: "unknown", counts: {}};
    let threes = 0, nonThree = 0, empty = 0, skippedNonEnrolled = 0;
    for (let i = 0; i < values.length; i++) {
      const value = norm(values[i]), id = String(studentIds[i]);
      if (/^[2-5]$/.test(value)) {
        if (value === "3") threes++; else nonThree++;
      } else if (value === "" || value === "—" || value === "-") {
        if (validSkip(skips[id], task, id)) skippedNonEnrolled++; else empty++;
      } else return {status: "unknown", counts: {}};
    }
    return {status: empty === 0 ? "complete" : "incomplete",
      counts: {total: values.length, threes, nonThree, empty,
        skippedNonEnrolled, scored: threes + nonThree}};
  }
  globalThis.__barsEnrollmentSkip = Object.freeze({
    norm, same, group, parseWarning, fullDate, matchWarning, validSkip, evaluate
  });
})();
