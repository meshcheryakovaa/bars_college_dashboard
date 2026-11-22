/* Isolated-world storage bridge. Page never receives extension storage permissions. */
(() => {
  "use strict";
  if (globalThis.__barsEnrollmentSkipBridge) return;
  globalThis.__barsEnrollmentSkipBridge = true;
  const model = globalThis.__barsEnrollmentSkip;
  const prefix = "workflow:enrollment-skip:";
  window.addEventListener("message", async (event) => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin ||
      request?.channel !== "bars-enrollment-skip-v1" || request.kind !== "persist" ||
      !/^[\w-]{1,100}$/.test(String(request.requestId || ""))) return;
    let response = {channel: "bars-enrollment-skip-v1", kind: "ack",
      requestId: request.requestId, ok: false};
    try {
      const task = request.task, id = String(request.studentId || "");
      if (!task || task.origin !== location.origin || !task.period || !task.group ||
        !task.subject || !task.lessonId || !id || !request.studentName ||
        !model.matchWarning(request.warning, task, request.studentName))
        throw new Error("Предупреждение не соответствует журналу, дате или студенту.");
      // Verify that the exact journal, lesson and student were collected earlier.
      const all = await chrome.storage.local.get(null);
      const journals = Object.entries(all).filter(([key, journal]) =>
        key.startsWith("journal:") && journal.origin === task.origin &&
        journal.period === task.period && journal.group === task.group &&
        journal.subject === task.subject &&
        (journal.kind || "theoretical") === (task.practical ? "practical" : "theoretical"));
      if (journals.length !== 1) throw new Error("Не найден единственный собранный журнал.");
      const journal = journals[0][1];
      if (!journal.lessons?.some((lesson) =>
        String(lesson.id) === String(task.lessonId) &&
        String(lesson.date).slice(0, 5) === String(task.date).slice(0, 5)))
        throw new Error("ID занятия не найден в журнале.");
      if (!journal.students?.some((student) =>
        String(student.id) === id && model.same(student.name, request.studentName)))
        throw new Error("Студент отсутствует в собранном составе журнала.");
      const key = model.storageKey(task, id);
      if (!key.startsWith(prefix)) throw new Error("Некорректный ключ хранения.");
      const skip = {
        studentId: id, lessonId: String(task.lessonId),
        studentName: request.studentName,
        lessonDate: model.fullDate(task.date, task.period),
        reason: "not-enrolled-on-lesson-date",
        warning: model.norm(request.warning),
        checkedAt: new Date().toISOString()
      };
      await chrome.storage.local.set({[key]: skip});
      response = {...response, ok: true, skip};
    } catch (error) {
      response = {...response, error: error.message};
    }
    window.postMessage(response, location.origin);
  });
})();
