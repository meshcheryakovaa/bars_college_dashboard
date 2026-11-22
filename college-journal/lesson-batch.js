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

  // Shared validation ensures all write queues refer to distinct, stable lesson IDs.
  function validatedLessons(journal) {
    const lessons = [...(journal?.lessons || [])].sort(byLesson);
    const ids = lessons.map((lesson) => String(lesson.id));
    if (lessons.some((lesson) => lesson.id == null || String(lesson.id).trim() === "")
      || new Set(ids).size !== lessons.length) {
      throw new Error("Обнаружены отсутствующие или повторяющиеся ID занятий. Обновите сбор журнала.");
    }
    return lessons;
  }
  function prepareGrades(journal, entries = {}) {
    const queue = [], completed = [], attempted = [], unresolved = [], closed = [];
    const lessons = validatedLessons(journal);
    for (const lesson of lessons) {
      const state = entries[String(lesson.id)] || {};
      if (state.closed) {closed.push(lesson); continue;}
      if (state.graded) {completed.push(lesson); continue;}
      if (state.gradeNeedsReview) {unresolved.push(lesson); continue;}
      if (state.gradeAttempted || /^Оценки:/.test(state.lastAction || "")) {
        attempted.push(lesson);
        continue;
      }
      queue.push(lesson);
    }
    return {queue, completed, attempted, unresolved, closed, total: lessons.length};
  }
  function prepareClose(journal, entries = {}) {
    const queue = [], completed = [], attempted = [], unresolved = [], blocked = [];
    const lessons = validatedLessons(journal);
    for (const lesson of lessons) {
      const state = entries[String(lesson.id)] || {};
      if (state.closed) {completed.push(lesson); continue;}
      if (state.closeNeedsReview) {unresolved.push(lesson); continue;}
      if (state.closeAttempted || /^Закрытие:/.test(state.lastAction || "")) {
        attempted.push(lesson);
        continue;
      }
      if (!state.linked || !state.graded) {
        blocked.push({lesson, needsKtp: !state.linked, needsGrades: !state.graded});
        continue;
      }
      queue.push(lesson);
    }
    return {queue, completed, attempted, unresolved, blocked, total: lessons.length};
  }

  // BARS показывает закрытие занятия на один запрос позже.
  // Отправка [A, B, C] и проверки: close(A), close(B), verify(A),
  // close(C), verify(B), refresh+verify(C). Последний может остаться
  // неподтверждённым — его НЕЛЬЗЯ повторно закрывать автоматически.
  async function runDelayedClose(queue, hooks) {
    let submitted = 0, verified = 0, previous = null, reason = "";
    for (const lesson of queue) {
      if (hooks.stopped()) {
        reason = "Операция остановлена пользователем.";
        break;
      }
      if (!await hooks.beforeSubmit(lesson, {submitted, verified})) {
        reason = "Не удалось сохранить защитную отметку до закрытия занятия.";
        break;
      }
      let sent;
      try {
        sent = await hooks.submit(lesson);
      } catch (error) {
        sent = {ok: false, message: error.message};
      }
      if (!sent?.ok) {
        await hooks.onError(lesson, sent);
        reason = "Не удалось отправить закрытие: " + (sent?.message || "неизвестная ошибка");
        break;
      }
      submitted++;
      if (!await hooks.onSubmitted(lesson, sent)) {
        reason = "Запрос отправлен, но результат не удалось сохранить локально.";
        break;
      }
      if (previous) {
        let check;
        try {
          check = await hooks.verify(previous, false);
        } catch (error) {
          check = {ok: false, verified: false, message: error.message};
        }
        if (!check?.ok || !check.verified) {
          await hooks.onUnverified(previous, check);
          reason = "Не подтверждено предыдущее занятие: " +
            (check?.message || "состояние неизвестно");
          break;
        }
        if (!await hooks.onVerified(previous, check)) {
          reason = "Закрытие предыдущего занятия подтверждено, но не удалось сохранить результат.";
          break;
        }
        verified++;
      }
      previous = lesson;
      await hooks.progress({submitted, verified, previous});
    }
    if (!reason && previous) {
      // Не посылаем фиктивное закрытие следующего занятия. Для последнего
      // делаем штатное обновление журнала и повторное чтение состояния.
      let final;
      try {
        final = await hooks.verify(previous, true);
      } catch (error) {
        final = {ok: false, verified: false, message: error.message};
      }
      if (final?.ok && final.verified) {
        if (await hooks.onVerified(previous, final)) {
          verified++;
          previous = null;
        } else {
          reason = "Закрытие последнего занятия подтверждено, но локальная запись не сохранилась.";
        }
      } else {
        await hooks.onUnverified(previous, final);
      }
    }
    return {submitted, verified, pending: previous, reason};
  }
  globalThis.collegeLessonBatch = Object.freeze({prepare, prepareGrades, prepareClose, runDelayedClose});
})();
