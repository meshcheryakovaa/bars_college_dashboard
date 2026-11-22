/* План заполнения и проверяемые действия через штатный UI БАРС. */
(() => {
  "use strict";
  const prefix = "workflow:plan:";
  const journalSelect = document.querySelector("#workflow-journal");
  const body = document.querySelector("#workflow-rows");
  const status = document.querySelector("#workflow-status");
  const summary = document.querySelector("#workflow-summary");
  const numberAll = document.querySelector("#workflow-number-all");
  const batchBindButton = document.querySelector("#workflow-bind-all");
  const batchPanel = document.querySelector("#workflow-batch-status");
  const batchText = document.querySelector("#workflow-batch-text");
  const batchProgress = document.querySelector("#workflow-batch-progress");
  const resetPlan = document.querySelector("#workflow-reset");
  const stopAction = document.querySelector("#workflow-stop");
  const prepareAll = document.querySelector("#workflow-prepare-all");
  const selection = document.querySelector("#workflow-select");
  const source = new URLSearchParams(location.search).get("sourceTab");
  const sourceTabId = /^\d+$/.test(source || "") ? Number(source) : null;
  let journals = [];
  let selectedKey = "";
  let plans = {};
  let saving = false;
  let actionBusy = false;
  let stopRequested = false;
  let batchStatus = null;

  const keyFor = (key) => {
    const journal = journals.find((item) => item.key === key);
    return journal ? prefix + JSON.stringify([
      journal.origin, journal.period, journal.group, journal.subject, journal.kind || "theoretical"
    ]) : prefix + key;
  };
  const norm = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const stateFor = (id) => plans[String(id)] || {};
  const storeState = (id, patch) => {
    plans[String(id)] = {...stateFor(id), ...patch};
    return persist();
  };
  const validNumber = (value) => value === "" || (/^[1-9]\d{0,3}$/.test(String(value)));
  const title = (journal) => [
    journal.group, journal.subject, journal.kind === "practical" ? "Практический" : "Теоретический", journal.period
  ].filter(Boolean).join(" · ");

  function message(text, error = false) {
    status.textContent = text;
    status.dataset.error = String(error);
  }
  function makeCell(row, value) {
    const cell = document.createElement("td");
    if (value instanceof Node) cell.append(value);
    else cell.textContent = String(value == null ? "" : value);
    row.append(cell);
    return cell;
  }
  function button(label, handler, disabled = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.disabled = disabled;
    element.addEventListener("click", handler);
    return element;
  }
  function checkbox(label, checked, handler, disabled = false) {
    const wrapper = document.createElement("label");
    wrapper.className = "workflow-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener("change", () => handler(input.checked));
    wrapper.append(input, document.createTextNode(label));
    return wrapper;
  }
  function current() {
    return journals.find((item) => item.key === selectedKey);
  }
  function lessonOrder(journal) {
    return [...journal.lessons].sort((a, b) => {
      const x = Number(a.number), y = Number(b.number);
      if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
      return String(a.date).localeCompare(String(b.date), "ru", {numeric: true});
    });
  }
  function count(journal) {
    const ids = journal.lessons.map((item) => String(item.id));
    return {
      total: ids.length,
      linked: ids.filter((id) => stateFor(id).linked).length,
      graded: ids.filter((id) => stateFor(id).graded).length,
      closed: ids.filter((id) => stateFor(id).closed).length,
      attempted: ids.filter((id) => stateFor(id).bindAttempted && !stateFor(id).linked).length
    };
  }
  async function persist() {
    if (!selectedKey) return;
    saving = true;
    try {
      await chrome.storage.local.set({[keyFor(selectedKey)]: {version: 1, entries: structuredClone(plans), updatedAt: Date.now()}});
      if (!actionBusy) message("План сохранён локально.");
      return true;
    } catch (error) {
      message("Не удалось сохранить план: " + error.message, true);
      return false;
    } finally {
      saving = false;
    }
  }
  function renderBatchProgress() {
    batchPanel.hidden = !batchStatus;
    if (!batchStatus) return;
    batchProgress.max = Math.max(1, batchStatus.total);
    batchProgress.value = batchStatus.completed;
    batchText.textContent = batchStatus.text;
  }

  function renderRows() {
    renderBatchProgress();
    body.replaceChildren();
    const journal = current();
    journalSelect.disabled = actionBusy;
    stopAction.disabled = !actionBusy || sourceTabId === null;
    prepareAll.disabled = actionBusy || !journal;
    batchBindButton.disabled = actionBusy || !journal || sourceTabId === null;
    if (!journal) {
      summary.textContent = "Выберите собранный журнал.";
      numberAll.disabled = resetPlan.disabled = true;
      return;
    }
    numberAll.disabled = resetPlan.disabled = actionBusy;
    const c = count(journal);
    summary.textContent = "Занятий: " + c.total + " · КТП подтверждено: " + c.linked
      + " · Оценки подтверждены: " + c.graded + " · Закрытие подтверждено: " + c.closed
      + " · КТП отправлено, ожидает проверки: " + c.attempted
      + " · Студентов: " + journal.students.length;

    for (const lesson of lessonOrder(journal)) {
      const id = String(lesson.id);
      const state = stateFor(id);
      const row = document.createElement("tr");
      row.dataset.lessonId = id;
      makeCell(row, lesson.date);
      makeCell(row, lesson.number);
      const entry = document.createElement("input");
      entry.className = "workflow-number";
      entry.type = "number";
      entry.min = "1";
      entry.max = "9999";
      entry.step = "1";
      entry.placeholder = "№ темы";
      entry.value = state.ktpNumber || "";
      entry.disabled = actionBusy;
      entry.setAttribute("aria-label", "№ КТП для " + lesson.date + ", занятие " + lesson.number);
      entry.addEventListener("change", async () => {
        const value = entry.value.trim();
        if (!validNumber(value)) {
          entry.setCustomValidity("Укажите целое число от 1 до 9999.");
          entry.reportValidity();
          return;
        }
        entry.setCustomValidity("");
        await storeState(id, {ktpNumber: value, linked: false, closed: false,
          bindAttempted: false, bindNeedsReview: false, lastAction: ""});
        renderRows();
      });
      makeCell(row, entry);
      const grade = document.createElement("div");
      grade.className = "workflow-score";
      grade.append(document.createTextNode("«3» × " + journal.students.length));
      const prepared = checkbox("Подготовлено", Boolean(state.gradesPrepared),
        (checked) => { void storeState(id, {gradesPrepared: checked, graded: false, closed: false}).then(renderRows); });
      prepared.querySelector("input").disabled = actionBusy;
      grade.append(prepared);
      makeCell(row, grade);
      const checks = document.createElement("div");
      checks.className = "workflow-checks";
      checks.append(
        checkbox("КТП привязано", Boolean(state.linked), (checked) => {
          void storeState(id, {linked: checked, closed: false,
            ...(checked ? {} : {bindAttempted: false, bindNeedsReview: false, lastAction: ""})}).then(renderRows);
        }, actionBusy || !state.ktpNumber),
        checkbox("Тройки внесены", Boolean(state.graded), (checked) => {
          void storeState(id, {graded: checked, closed: false}).then(renderRows);
        }, actionBusy || !state.gradesPrepared),
        checkbox("Занятие закрыто", Boolean(state.closed), (checked) => {
          if (checked && !window.confirm("Подтвердите, что занятие действительно закрыто в БАРС. Это отметка ручной проверки.")) {
            renderRows();
            return;
          }
          void storeState(id, {closed: checked}).then(renderRows);
        }, actionBusy || !state.linked || !state.graded)
      );
      makeCell(row, checks);
      const actions = document.createElement("div");
      actions.className = "workflow-actions";
      actions.append(
        button("Сверить", () => void runLessonAction(journal, lesson, "check"), actionBusy || sourceTabId === null),
        button("Привязать КТП", () => void runLessonAction(journal, lesson, "bind"),
          actionBusy || sourceTabId === null || !state.ktpNumber),
        button("Всем «3»", () => void runLessonAction(journal, lesson, "grades"),
          actionBusy || sourceTabId === null),
        button("Закрыть занятие", () => void runLessonAction(journal, lesson, "close"),
          actionBusy || sourceTabId === null || !state.linked || !state.graded)
      );
      if (state.lastAction) {
        const info = document.createElement("small");
        info.className = "workflow-last";
        info.textContent = state.lastAction;
        actions.append(info);
      }
      makeCell(row, actions);
      body.append(row);
    }
  }
  async function loadPlan() {
    plans = {};
    const journal = current();
    if (journal) {
      const saved = await chrome.storage.local.get([keyFor(selectedKey), prefix + selectedKey]);
      if (current()?.key !== journal.key) return;
      plans = (saved[keyFor(selectedKey)] || saved[prefix + selectedKey])?.entries || {};
    }
    renderRows();
  }
  async function refresh() {
    const records = await chrome.storage.local.get(null);
    journals = Object.entries(records).filter(([key, value]) =>
      key.startsWith("journal:") && value && Array.isArray(value.lessons) && Array.isArray(value.students))
      .map(([key, journal]) => ({key, ...journal}))
      .sort((a, b) => title(a).localeCompare(title(b), "ru", {numeric: true}));
    const old = selectedKey;
    journalSelect.replaceChildren();
    journalSelect.append(new Option("Выберите журнал", ""));
    for (const journal of journals) journalSelect.append(new Option(title(journal), journal.key));
    selectedKey = journals.some((item) => item.key === old) ? old : "";
    journalSelect.value = selectedKey;
    selection.hidden = !journals.length;
    await loadPlan();
  }
  stopAction.addEventListener("click", () => {
    if (sourceTabId === null || !actionBusy) return;
    stopRequested = true;
    message("Остановка запрошена. Уже отправленные изменения в БАРС не отменяются.");
    void chrome.scripting.executeScript({target: {tabId: sourceTabId}, world: "MAIN",
      func: () => window.__barsLessonActions?.stop()}).catch((error) => message("Не удалось остановить: " + error.message, true));
  });
  journalSelect.addEventListener("change", () => {
    selectedKey = journalSelect.value;
    void loadPlan();
  });
  numberAll.addEventListener("click", async () => {
    const journal = current();
    if (!journal || !window.confirm("Заполнить пустые № КТП номерами занятий? Существующие номера сохранятся. Привязка на сайте не выполняется.")) return;
    let affected = 0;
    for (const lesson of journal.lessons) {
      const id = String(lesson.id), state = stateFor(id);
      if (!state.ktpNumber && validNumber(String(lesson.number)) && String(lesson.number)) {
        plans[id] = {...state, ktpNumber: String(Number(lesson.number))};
        affected++;
      }
    }
    await persist();
    renderRows();
    message("Заполнено номеров КТП: " + affected + ". Проверьте их перед привязкой в БАРС.");
  });
  resetPlan.addEventListener("click", async () => {
    if (!current() || !window.confirm("Удалить локальный план выбранного журнала? Записи БАРС не изменятся.")) return;
    await chrome.storage.local.remove(keyFor(selectedKey));
    plans = {};
    renderRows();
    message("Локальный план выбранного журнала удалён.");
  });
  document.querySelector("#workflow-prepare-all").addEventListener("click", async () => {
    const journal = current();
    if (!journal || !journal.lessons.length || !window.confirm(
      "Подготовить выставление «3» для всех студентов во всех занятиях выбранного журнала? Это создаст только локальный план, без записи оценок на сайт."
    )) return;
    for (const lesson of journal.lessons) {
      const id = String(lesson.id);
      plans[id] = {...stateFor(id), gradesPrepared: true};
    }
    await persist();
    renderRows();
    message("Тройки подготовлены для " + journal.lessons.length + " занятий. Внесите их в БАРС и подтвердите по каждому занятию.");
  });

  // Commands execute in the already open BARS tab without activating or focusing it.
  // Chrome host permission is limited to college.72to.ru (manifest.json).
  function lessonPayload(journal, lesson, action) {
    return {
      action,
      origin: journal.origin,
      group: journal.group,
      subject: journal.subject,
      practical: journal.kind === "practical",
      lessonId: String(lesson.id),
      number: String(lesson.number),
      date: String(lesson.date),
      ktpNumber: String(stateFor(String(lesson.id)).ktpNumber || ""),
      studentIds: journal.students.map(({id}) => String(id))
    };
  }

  async function executeLessonOperation(journal, lesson, action) {
    if (sourceTabId === null) throw new Error(
      "Откройте дашборд из меню расширения на вкладке Электронного колледжа.");
    const target = {tabId: sourceTabId};
    // Do not use chrome.tabs.update(active:true) or chrome.windows.update(focused:true).
    await chrome.scripting.executeScript({target, world: "MAIN", files: ["lesson-actions-page.js"]});
    const output = await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func: (payload) => window.__barsLessonActions.run(payload),
      args: [lessonPayload(journal, lesson, action)]
    });
    const result = output?.[0]?.result;
    if (!result || typeof result.ok !== "boolean") {
      throw new Error("БАРС не вернул состояние операции.");
    }
    return result;
  }

  async function saveActionOutcome(lesson, action, result) {
    if (!result.ok || action === "check") return true;
    const patch = {
      lastAction: ({bind: "КТП", grades: "Оценки", close: "Закрытие"}[action] || action)
        + ": " + (result.verified ? "подтверждено" : "требует проверки"),
      lastActionAt: new Date().toISOString()
    };
    if (action === "bind") {
      patch.bindAttempted = true;
      patch.bindNeedsReview = false;
      if (result.verified) patch.linked = true;
    }
    if (result.verified && action === "grades") {
      patch.gradesPrepared = true;
      patch.graded = true;
    }
    if (result.verified && action === "close") patch.closed = true;
    return storeState(String(lesson.id), patch);
  }

  async function runLessonAction(journal, lesson, action) {
    if (actionBusy) return;
    if (sourceTabId === null) {
      message("Откройте дашборд из меню расширения на вкладке Электронного колледжа.", true);
      return;
    }
    const state = stateFor(String(lesson.id));
    if (action === "bind" && !/^[1-9]\d{0,3}$/.test(String(state.ktpNumber || ""))) {
      message("Укажите корректный № темы КТП для выбранного занятия.", true);
      return;
    }
    if (action === "close" && (!state.linked || !state.graded)) {
      message("Перед закрытием подтвердите привязку КТП и внесение троек.", true);
      return;
    }
    const prompts = {
      bind: "Привязать тему КТП № " + state.ktpNumber + " к занятию " + lesson.number +
        " (" + lesson.date + ")? Это действие изменяет данные в БАРС." +
        (state.bindAttempted ? " ВНИМАНИЕ: запрос ранее уже отправлялся, проверьте возможную повторную привязку." : ""),
      grades: "Выставить «3» студентам (" + journal.students.length + ") в занятии " +
        lesson.number + "? Непустые оценки не будут перезаписаны.",
      close: "Закрыть занятие " + lesson.number + " (" + lesson.date + ") в БАРС?"
    };
    if (prompts[action] && !window.confirm(prompts[action])) return;
    actionBusy = true;
    stopRequested = false;
    renderRows();
    message("Выполняется " + action + " для занятия № " + lesson.number +
      " без переключения вкладок. Не изменяйте открытый журнал БАРС.");
    try {
      const result = await executeLessonOperation(journal, lesson, action);
      const saved = await saveActionOutcome(lesson, action, result);
      message((result.ok ? "" : "Не выполнено: ") + result.message +
        (!saved ? " Изменение локального плана не сохранилось." : ""), !result.ok || !saved);
    } catch (error) {
      message("Ошибка обращения к БАРС: " + error.message +
        ". Проверьте, что вкладка колледжа открыта и расширению разрешён доступ к сайту.", true);
    } finally {
      actionBusy = false;
      stopRequested = false;
      renderRows();
    }
  }

  async function runBatchBinding() {
    if (actionBusy) return;
    const journal = current();
    if (!journal || sourceTabId === null) {
      message("Выберите журнал и откройте дашборд из меню расширения на вкладке колледжа.", true);
      return;
    }
    let plan;
    try {
      plan = collegeLessonBatch.prepare(journal, plans);
    } catch (error) {
      message(error.message, true);
      return;
    }
    if (plan.missing.length) {
      message("Пакетная привязка не запущена: у " + plan.missing.length +
        " занятий не заполнен корректный № темы КТП (" +
        plan.missing.slice(0, 5).map(({number, date}) => "№ " + number + " / " + date).join(", ") +
        "). Заполните номера, затем повторите.", true);
      return;
    }
    if (!plan.queue.length) {
      message("Новых тем для пакетной привязки нет. Уже подтверждено: " + plan.linked.length +
        ", запрос отправлен ранее: " + plan.attempted.length +
        ", требуется разбор ошибки: " + plan.unresolved.length + ".", plan.unresolved.length > 0);
      return;
    }
    const prompt = "Последовательно привязать темы КТП для " + plan.queue.length +
      " занятий журнала «" + title(journal) + "»?\n\n" +
      "Уже подтверждено: " + plan.linked.length +
      ". Ранее отправлено, ожидает проверки: " + plan.attempted.length +
      ". Неясный результат предыдущих операций: " + plan.unresolved.length + ".\n\n" +
      "Вкладка с дашбордом останется активной. Очередь остановится при первой ошибке.";
    if (!window.confirm(prompt)) return;

    actionBusy = true;
    stopRequested = false;
    let completed = 0;
    let reason = "";
    batchStatus = {completed: 0, total: plan.queue.length,
      text: "Пакетная привязка КТП: 0 из " + plan.queue.length + "."};
    renderRows();
    try {
      for (const lesson of plan.queue) {
        if (stopRequested) {
          reason = "Операция остановлена пользователем.";
          break;
        }
        const id = String(lesson.id);
        batchStatus.text = "Привязка КТП " + (completed + 1) + " из " + plan.queue.length +
          ": занятие № " + lesson.number + ", " + lesson.date +
          ", тема № " + stateFor(id).ktpNumber + ".";
        renderBatchProgress();
        let result;
        try {
          result = await executeLessonOperation(journal, lesson, "bind");
        } catch (error) {
          result = {ok: false, message: error.message};
        }
        if (!result.ok) {
          // Once a command has been attempted the server state could be uncertain.
          // Do not automatically retry that lesson in a later batch.
          const saved = await storeState(id, {
            bindNeedsReview: true,
            lastAction: "КТП: проверить после ошибки",
            lastActionAt: new Date().toISOString()
          });
          reason = "Остановлено на занятии № " + lesson.number + " (" + lesson.date +
            "): " + result.message +
            (saved ? " Проверьте эту дату в БАРС перед повторной отправкой." :
              " Локальный результат не удалось сохранить.");
          break;
        }
        const saved = await saveActionOutcome(lesson, "bind", result);
        if (!saved) {
          reason = "БАРС обработал занятие № " + lesson.number +
            ", но не удалось сохранить локальный результат; очередь остановлена.";
          break;
        }
        completed++;
        batchStatus.completed = completed;
        batchStatus.text = "Пакетная привязка КТП: " + completed + " из " +
          plan.queue.length + ". Последнее занятие — № " + lesson.number +
          " (" + lesson.date + ")." + (result.verified ? "" : " Требуется проверка результата в БАРС.");
        renderRows();
        message(batchStatus.text);
      }
    } catch (error) {
      reason = "Пакетная операция прервана: " + error.message;
    } finally {
      actionBusy = false;
      stopRequested = false;
      const complete = completed === plan.queue.length && !reason;
      batchStatus.text = (complete ? "Очередь завершена. " : "Очередь остановлена. ") +
        "Обработано " + completed + " из " + plan.queue.length + "." +
        (reason ? " " + reason : " Проверьте записи КТП в БАРС; неподтверждённые привязки отмечены отдельно.");
      renderRows();
      message(batchStatus.text, !complete);
    }
  }

  batchBindButton.addEventListener("click", () => void runBatchBinding());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || saving) return;
    const keys = Object.keys(changes);
    if (keys.some((key) => key.startsWith("journal:") || key === keyFor(selectedKey) || key === "dashboard:cleared-at")) {
      void refresh().catch((error) => message(error.message, true));
    }
  });
  void refresh().catch((error) => message("Ошибка загрузки: " + error.message, true));
})();
