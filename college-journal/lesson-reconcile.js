/* Pure three-way BARS reconciliation: confirmed, missing, unknown. */
(() => {
  "use strict";
  function reconcile(snapshot, entry = {}) {
    if (!snapshot?.ok || !snapshot.state) {
      return {patch: {}, issues: ["Не удалось независимо прочитать состояние БАРС."], safe: false};
    }
    const state = snapshot.state, patch = {}, issues = [];
    const actualTopic = state.ktp?.status === "confirmed" ? String(state.ktp.topic) : null;
    const expected = String(entry.ktpNumber || "");
    if (actualTopic != null) {
      if (actualTopic === expected && expected) {
        Object.assign(patch, {linked: true, bindAttempted: true, bindNeedsReview: false});
      } else {
        issues.push("В БАРС тема № " + actualTopic +
          ", а в плане № " + (expected || "не указано") + ". Исправьте несоответствие вручную.");
        Object.assign(patch, {linked: false, bindNeedsReview: true});
      }
    } else if (entry.bindAttempted && !entry.linked) {
      issues.push("Номер ранее привязанной темы КТП не определяется по доступным полям БАРС.");
      patch.bindNeedsReview = true;
    }
    if (state.grades?.status === "complete") {
      Object.assign(patch, {gradesPrepared: true, graded: true,
        gradeAttempted: true, gradeNeedsReview: false});
    } else if (state.grades?.status === "incomplete") {
      // Заполнять только пустые: gradeAll никогда не заменяет 4/5.
      patch.graded = false;
      if (entry.gradeAttempted) patch.gradeNeedsReview = false;
    } else {
      if (entry.gradeAttempted && !entry.graded)
        issues.push("Оценочная колонка не может быть однозначно прочитана.");
    }
    if (state.closure === "closed") {
      Object.assign(patch, {closed: true, closeAttempted: true, closeNeedsReview: false});
    } else if (state.closure === "open") {
      patch.closed = false;
      if (entry.closeAttempted) {
        patch.closeNeedsReview = true;
        issues.push("Занятие отображается открытым после ранее отправленного закрытия. Повтор без ручной проверки заблокирован.");
      }
    } else if (entry.closeAttempted && !entry.closed) {
      issues.push("Статус закрытия пока не определён.");
    }
    const merged = {...entry, ...patch};
    const safe = !issues.length &&
      !(!merged.linked && merged.bindAttempted) &&
      !(!merged.closed && merged.closeAttempted);
    return {patch, issues, safe,
      confirmed: {ktp: merged.linked === true, grades: merged.graded === true,
        closed: merged.closed === true}};
  }

  function auditJournal(journal, entries = {}, remote) {
    const issues = [], warnings = [];
    const ids = new Set();
    if (!journal?.lessons?.length) issues.push("В локальном журнале нет занятий.");
    if (!journal?.students?.length) issues.push("В локальном журнале нет списка студентов.");
    for (const lesson of journal?.lessons || []) {
      const id = String(lesson.id || "");
      if (!id || ids.has(id)) issues.push("Отсутствующий или повторный ID занятия.");
      ids.add(id);
      const state = entries[id] || {};
      if (!/^[1-9]\d{0,3}$/.test(String(state.ktpNumber || "")) && !state.closed)
        issues.push("Занятие № " + lesson.number + " (" + lesson.date + "): не назначен номер КТП.");
      if (state.bindAttempted && !state.linked ||
        state.gradeAttempted && !state.graded ||
        state.closeAttempted && !state.closed)
        warnings.push("Занятие № " + lesson.number + ": требуется независимая сверка ранее отправленных операций.");
    }
    if (remote) {
      if (remote.error) issues.push("Не удалось открыть журнал: " + remote.error);
      else {
        if (remote.group !== journal.group || remote.subject !== journal.subject ||
          (remote.kind || "theoretical") !== (journal.kind || "theoretical"))
          issues.push("В открытой вкладке другой журнал, группа или предмет.");
        const expectedStudents = new Set((journal.students || []).map((s) => String(s.id)));
        const actualStudents = new Set((remote.studentIds || []).map(String));
        if (expectedStudents.size !== actualStudents.size ||
          [...expectedStudents].some((id) => !actualStudents.has(id)))
          issues.push("Состав студентов в БАРС изменился.");
        const actualLessons = new Set((remote.lessonIds || []).map(String));
        if ([...ids].some((id) => !actualLessons.has(id)))
          issues.push("Не найдены все сохранённые ID занятий.");
      }
    }
    return {ready: !issues.length, issues, warnings, lessonCount: journal?.lessons?.length || 0};
  }
  globalThis.collegeLessonReconcile = Object.freeze({reconcile, auditJournal});
})();
