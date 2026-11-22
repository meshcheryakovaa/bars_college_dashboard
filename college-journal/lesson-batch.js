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

  // Возобновление после старой версии: разрешена ровно одна отложенная
  // проверка уже ОТПРАВЛЕННОГО закрытия, перед всеми новыми занятиями.
  // Если запрос завершился сетевой ошибкой, запись не считается отправленной.
  function resumableClose(plan, entries = {}) {
    if (!plan?.queue?.length || plan.blocked.length) return null;
    const unsettled = [...plan.attempted, ...plan.unresolved];
    if (unsettled.length !== 1) return null;
    const candidate = unsettled[0];
    const state = entries[String(candidate.id)] || {};
    if (!state.closeAttempted || !state.closeNeedsReview ||
      !/^Закрытие: (требует проверки|ожидает проверки|запрос отправлен|не подтверждено)/.test(state.lastAction || "")) {
      return null;
    }
    const first = plan.queue[0];
    const n = Number(candidate.number), f = Number(first.number);
    if (!(Number.isFinite(n) && Number.isFinite(f) && n < f)) return null;
    return candidate;
  }

  // BARS показывает закрытие занятия на один запрос позже.
  // Отправка [A, B, C] и проверки: close(A), close(B), verify(A),
  // close(C), verify(B), refresh+verify(C). Последний может остаться
  // неподтверждённым — его НЕЛЬЗЯ повторно закрывать автоматически.
  async function runDelayedClose(queue, hooks) {
    let submitted = 0, verified = 0, previous = hooks.initialPending || null, reason = "";
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
  // Даты 01.09–31.08 принадлежат одному учебному году; в одну дату
  // порядок задаёт номер занятия. По каждой записи обязательно уникальный ID.
  function lessonsByDate(journal) {
    const lessons = validatedLessons(journal);
    const period = /^(\d{4})\s*[-/]\s*(\d{4})$/.exec(String(journal?.period || ""));
    const dateKey = (lesson) => {
      const match = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?$/.exec(String(lesson.date || ""));
      if (!match) throw new Error("Не распознана дата занятия № " + lesson.number + ": " + lesson.date);
      const day = Number(match[1]), month = Number(match[2]);
      const year = match[3]
        ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]))
        : period ? (Number(period[1]) + (month < 9 ? 1 : 0))
          : (month < 9 ? 2001 : 2000);
      if (month < 1 || month > 12 ||
        new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day ||
        new Date(Date.UTC(year, month - 1, day)).getUTCMonth() !== month - 1)
        throw new Error("Некорректная дата занятия № " + lesson.number + ": " + lesson.date);
      return year * 10000 + month * 100 + day;
    };
    return lessons.map((lesson, index) => ({lesson, index, date: dateKey(lesson)}))
      .sort((a, b) => a.date - b.date || Number(a.lesson.number) - Number(b.lesson.number) || a.index - b.index)
      .map((item) => item.lesson);
  }

  function assignKtpSequence(journal, start) {
    const value = String(start).trim();
    if (!numeric(value)) throw new Error("Начальный № КТП — целое число от 1 до 9999.");
    const lessons = lessonsByDate(journal);
    const first = Number(value);
    if (first + lessons.length - 1 > 9999)
      throw new Error("Номера тем КТП выходят за пределы 9999.");
    return lessons.map((lesson, index) => ({lesson, ktpNumber: String(first + index)}));
  }

  function prepareFull(journal, entries = {}) {
    const queue = [], completed = [], problems = [];
    const lessons = lessonsByDate(journal);
    for (const lesson of lessons) {
      const state = entries[String(lesson.id)] || {};
      if (state.closed) {completed.push(lesson); continue;}
      if (!numeric(state.ktpNumber)) {
        problems.push({lesson, reason: "не указан номер темы КТП"});
        continue;
      }
      // Не допускается повторная отправка действий с неизвестным результатом.
      if (!state.linked && (state.bindAttempted || state.bindNeedsReview)) {
        problems.push({lesson, reason: "ранее отправленная привязка КТП требует проверки"});
        continue;
      }
      if (!state.graded && (state.gradeAttempted || state.gradeNeedsReview)) {
        problems.push({lesson, reason: "ранее выставленные оценки требуют проверки"});
        continue;
      }
      if (state.closeAttempted || state.closeNeedsReview) {
        problems.push({lesson, reason: "предыдущее закрытие требует проверки"});
        continue;
      }
      queue.push(lesson);
    }
    return {queue, completed, problems, total: lessons.length};
  }

  // Один урок полностью обрабатывается до перехода к следующей дате.
  // После close всегда выполняется refresh + verify. Если БАРС отображает
  // закрытие на один урок позже, максимум один урок остаётся pending;
  // после закрытия следующего проверяется предыдущее, без повторного close.
  async function runFillDates(queue, hooks) {
    let processed = 0, verifiedClose = 0, pending = null, reason = "";
    const perform = async (lesson, stage) => {
      try {
        return await hooks.perform(lesson, stage);
      } catch (error) {
        return {ok: false, verified: false, message: error.message};
      }
    };
    const verify = async (lesson, final) => {
      try {
        return await hooks.verify(lesson, final);
      } catch (error) {
        return {ok: false, verified: false, message: error.message};
      }
    };
    for (const lesson of queue) {
      if (hooks.stopped()) {
        reason = "Остановлено пользователем.";
        break;
      }
      let failed = false;
      for (const stage of ["bind", "grades"]) {
        if (!hooks.needed(lesson, stage)) continue;
        await hooks.progress({lesson, stage, processed, verifiedClose});
        const result = await perform(lesson, stage);
        if (!result?.ok || stage === "grades" && !result.verified) {
          reason = "Занятие № " + lesson.number + " (" + lesson.date + "), этап " +
            (stage === "bind" ? "КТП" : "оценки") + ": " +
            (result?.message || "не подтверждено");
          failed = true;
          break;
        }
      }
      if (failed) break;
      if (hooks.stopped()) {
        reason = "Остановлено пользователем до закрытия занятия № " + lesson.number + ".";
        break;
      }
      if (hooks.needed(lesson, "close")) {
        await hooks.progress({lesson, stage: "close", processed, verifiedClose});
        const result = await perform(lesson, "close");
        if (!result?.ok) {
          reason = "Занятие № " + lesson.number + " (" + lesson.date +
            "), закрытие: " + (result?.message || "неизвестная ошибка");
          break;
        }
        // Строго после каждого закрытия: штатное «Обновить» и чтение
        // выбранного занятия. Отрицательный ответ может быть задержкой.
        await hooks.progress({lesson, stage: "refresh", processed, verifiedClose});
        const current = await verify(lesson, true);
        const previous = pending;
        if (previous) {
          const previousResult = await verify(previous, false);
          if (!previousResult?.ok || !previousResult.verified) {
            reason = "После следующего закрытия не удалось подтвердить занятие № " +
              previous.number + " (" + previous.date + "): " +
              (previousResult?.message || "статус не определён");
            // Текущее закрытие уже было отправлено. Не повторяем его.
            pending = current?.verified ? null : lesson;
            break;
          }
          verifiedClose++;
        }
        if (current?.ok && current.verified) {
          verifiedClose++;
          pending = null;
        } else {
          pending = lesson;
        }
      }
      processed++;
      await hooks.progress({lesson, stage: "done", processed, verifiedClose, pending});
    }
    // Дополнительная проверка последнего занятия без повторного закрытия.
    if (!reason && pending && !hooks.stopped()) {
      const last = await verify(pending, true);
      if (last?.ok && last.verified) {
        verifiedClose++;
        pending = null;
      }
    }
    return {processed, verifiedClose, pending, reason};
  }

  globalThis.collegeLessonBatch = Object.freeze({
    prepare, prepareGrades, prepareClose, resumableClose, runDelayedClose,
    lessonsByDate, assignKtpSequence, prepareFull, runFillDates
  });
})();
