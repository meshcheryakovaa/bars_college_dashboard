/* План заполнения и проверяемые действия через штатный UI БАРС. */
(() => {
  "use strict";
  const prefix = "workflow:plan:";
  const journalSelect = document.querySelector("#workflow-journal");
  const favoriteList = document.querySelector("#workflow-favorite-list");
  const favoriteCount = document.querySelector("#workflow-favorite-count");
  const queueRunButton = document.querySelector("#workflow-run-queue");
  const queueClearButton = document.querySelector("#workflow-clear-queue");
  const queueStatus = document.querySelector("#workflow-queue-status");
  const queueResults = document.querySelector("#workflow-queue-results");
  const preflightButton = document.querySelector("#workflow-preflight");
  const preflightResult = document.querySelector("#workflow-preflight-result");
  const resumeQueueButton = document.querySelector("#workflow-resume-queue");
  const reconcileButton = document.querySelector("#workflow-reconcile");
  const recheckClosuresButton = document.querySelector("#workflow-recheck-closures");
  const checkpointKey = "workflow:queue-checkpoint";
  const stopErrorsInput = document.querySelector("#workflow-stop-errors");
  const favoritesKey = "workflow:favorite-journals";
  const stopErrorsKey = "workflow:stop-on-errors";
  const body = document.querySelector("#workflow-rows");
  const status = document.querySelector("#workflow-status");
  const summary = document.querySelector("#workflow-summary");
  const numberAll = document.querySelector("#workflow-number-all");
  const ktpStart = document.querySelector("#workflow-ktp-start");
  const fullDatesButton = document.querySelector("#workflow-fill-dates");
  const batchBindButton = document.querySelector("#workflow-bind-all");
  const batchGradesButton = document.querySelector("#workflow-grades-all");
  const batchCloseButton = document.querySelector("#workflow-close-all");
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
  let ktpAssignmentPromise = null;
  let favoriteIds = [];
  let preferencesLoaded = false;
  let queueRunActive = false;
  let queueRunLabel = "";
  let queueLogs = [];
  let checkpoint = null;

  const keyFor = (key) => {
    const journal = journals.find((item) => item.key === key);
    return journal ? prefix + JSON.stringify([
      journal.origin, journal.period, journal.group, journal.subject, journal.kind || "theoretical"
    ]) : prefix + key;
  };
  const norm = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const journalIdentity = (journal) => JSON.stringify([
    journal.origin, journal.period, journal.group, journal.subject,
    journal.kind || "theoretical"
  ]);
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
      attempted: ids.filter((id) => stateFor(id).bindAttempted && !stateFor(id).linked).length,
      gradePending: ids.filter((id) => stateFor(id).gradeAttempted && !stateFor(id).graded).length,
      closePending: ids.filter((id) => stateFor(id).closeAttempted && !stateFor(id).closed).length
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

  function renderFavorites() {
    const scrollPosition = favoriteList.scrollTop;
    favoriteList.replaceChildren();
    const available = new Map(journals.map((j) => [journalIdentity(j), j]));
    favoriteCount.textContent = String(favoriteIds.length);
    queueRunButton.disabled = actionBusy || !favoriteIds.length || sourceTabId === null;
    queueClearButton.disabled = actionBusy || !favoriteIds.length;
    preflightButton.disabled = actionBusy || !favoriteIds.length || sourceTabId === null;
    resumeQueueButton.hidden = !(checkpoint && checkpoint.status !== "completed");
    resumeQueueButton.disabled = actionBusy || !checkpoint || sourceTabId === null;
    for (const id of favoriteIds) {
      const journal = available.get(id);
      if (!journal) {
        const missing = document.createElement("p");
        missing.textContent = "Журнал отсутствует в локальной базе: " + id;
        favoriteList.append(missing);
        continue;
      }
    }
    const choices = [...new Map(journals.map((j) => [journalIdentity(j), j])).values()];
    const ordered = [
      ...favoriteIds.map((id) => available.get(id)).filter(Boolean),
      ...choices.filter((j) => !favoriteIds.includes(journalIdentity(j)))
    ];
    for (const journal of ordered) {
      const id = journalIdentity(journal);
      const position = favoriteIds.indexOf(id);
      const item = document.createElement("div");
      item.className = "workflow-favorite" + (position >= 0 ? " is-selected" : "");
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = position >= 0;
      input.disabled = actionBusy;
      input.addEventListener("change", () => {
        if (input.checked && !favoriteIds.includes(id)) favoriteIds.push(id);
        if (!input.checked) favoriteIds = favoriteIds.filter((entry) => entry !== id);
        void saveFavorites();
      });
      label.append(input, document.createTextNode(
        (position < 0 ? "" : (position + 1) + ". ") + title(journal)));
      item.append(label);
      if (position >= 0) {
        for (const [offset, caption] of [[-1, "↑"], [1, "↓"]]) {
          const move = button(caption, () => {
            const pos = favoriteIds.indexOf(id), next = pos + offset;
            if (pos < 0 || next < 0 || next >= favoriteIds.length) return;
            [favoriteIds[pos], favoriteIds[next]] = [favoriteIds[next], favoriteIds[pos]];
            void saveFavorites();
          }, actionBusy || position + offset < 0 || position + offset >= favoriteIds.length);
          move.title = offset < 0 ? "Выше в очереди" : "Ниже в очереди";
          item.append(move);
        }
        const start = document.createElement("input");
        start.type = "number";
        start.min = "1";
        start.max = "9999";
        start.step = "1";
        start.className = "workflow-favorite-start";
        start.placeholder = "Начало КТП";
        start.setAttribute("aria-label", "Начальный номер КТП для " + title(journal));
        start.disabled = actionBusy;
        const setNumbers = button("КТП +1", () => {
          void assignFavoriteKtp(journal, start.value).catch((error) => {
            queueStatus.textContent = "Ошибка КТП для " + title(journal) + ": " + error.message;
          });
        }, actionBusy);
        item.append(start, setNumbers);
      }
      favoriteList.append(item);
    }
    favoriteList.scrollTop = scrollPosition;
  }

  async function assignFavoriteKtp(journal, value) {
    if (actionBusy) return;
    const assigned = collegeLessonBatch.assignKtpSequence(journal, value);
    if (!assigned.length) throw new Error("В журнале нет собранных занятий.");
    const storageKey = keyFor(journal.key);
    const stored = await chrome.storage.local.get([storageKey, prefix + journal.key]);
    const existing = (stored[storageKey] || stored[prefix + journal.key])?.entries || {};
    const conflicts = assigned.filter(({lesson, ktpNumber}) => {
      const state = existing[String(lesson.id)] || {};
      return state.ktpNumber && String(state.ktpNumber) !== ktpNumber &&
        (state.linked || state.bindAttempted || state.bindNeedsReview ||
          state.graded || state.gradeAttempted || state.gradeNeedsReview ||
          state.closed || state.closeAttempted || state.closeNeedsReview);
    });
    if (conflicts.length) {
      throw new Error("Номера КТП не изменены: " + conflicts.length +
        " занятий уже обрабатывались с другими темами. Сверьте их в БАРС.");
    }
    const updated = {...existing};
    for (const {lesson, ktpNumber} of assigned) {
      const id = String(lesson.id), state = existing[id] || {};
      if (String(state.ktpNumber || "") === ktpNumber) continue;
      updated[id] = {...state, ktpNumber, linked: false,
        bindAttempted: false, bindNeedsReview: false,
        lastAction: "", lastActionAt: ""};
    }
    await chrome.storage.local.set({[storageKey]: {
      version: 1, entries: updated, updatedAt: Date.now()
    }});
    if (selectedKey === journal.key) {
      plans = updated;
      ktpStart.value = String(value);
      renderRows();
    }
    queueStatus.textContent = "КТП назначены для " + title(journal) +
      ": темы № " + assigned[0].ktpNumber + "–" +
      assigned[assigned.length - 1].ktpNumber + ". Данные БАРС пока не изменялись.";
  }

  async function saveFavorites() {
    try {
      favoriteIds = [...new Set(favoriteIds)];
      await chrome.storage.local.set({[favoritesKey]: [...favoriteIds]});
      renderFavorites();
      queueStatus.textContent = "Избранные журналы сохранены. Очередь: " + favoriteIds.length + ".";
    } catch (error) {
      queueStatus.textContent = "Не удалось сохранить избранное: " + error.message;
    }
  }

  function renderQueueResults() {
    queueResults.replaceChildren();
    for (const record of queueLogs) {
      const item = document.createElement("li");
      item.textContent = record;
      queueResults.append(item);
    }
  }

  function renderRows() {
    window.dispatchEvent(new CustomEvent("college-workflow-busy", {detail: {busy: actionBusy}}));
    renderBatchProgress();
    renderFavorites();
    body.replaceChildren();
    const journal = current();
    journalSelect.disabled = actionBusy;
    stopErrorsInput.disabled = actionBusy;
    stopAction.disabled = !actionBusy || sourceTabId === null;
    prepareAll.disabled = actionBusy || !journal;
    batchBindButton.disabled = actionBusy || !journal || sourceTabId === null;
    batchGradesButton.disabled = actionBusy || !journal || sourceTabId === null;
    batchCloseButton.disabled = actionBusy || !journal || sourceTabId === null;
    fullDatesButton.disabled = actionBusy || !journal || sourceTabId === null;
    reconcileButton.disabled = actionBusy || !journal || sourceTabId === null;
    recheckClosuresButton.disabled = actionBusy || !journal || sourceTabId === null;
    ktpStart.disabled = actionBusy || !journal;
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
      + " · Оценки требуют проверки: " + c.gradePending
      + " · Закрытие требует проверки: " + c.closePending
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
          void storeState(id, {graded: checked, closed: false,
            ...(checked ? {gradeAttempted: true, gradeNeedsReview: false}
              : {gradeAttempted: false, gradeNeedsReview: false, closeAttempted: false,
                closeNeedsReview: false})}).then(renderRows);
        }, actionBusy || !state.gradesPrepared),
        checkbox("Занятие закрыто", Boolean(state.closed), (checked) => {
          if (checked && !window.confirm("Подтвердите, что занятие действительно закрыто в БАРС. Это отметка ручной проверки.")) {
            renderRows();
            return;
          }
          void storeState(id, {closed: checked,
            ...(checked ? {closeAttempted: true, closeNeedsReview: false}
              : {closeAttempted: false, closeNeedsReview: false})}).then(renderRows);
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
      if (!state.linked && (state.bindAttempted || state.bindNeedsReview || /^КТП:/.test(state.lastAction || ""))) {
        actions.append(button("Разрешить повтор КТП", () => {
          if (!window.confirm("Убедитесь в БАРС, что тема не привязалась. Сбросить локальную защиту от повторной отправки для занятия № " +
            lesson.number + " (" + lesson.date + ")?")) return;
          void storeState(id, {
            bindAttempted: false, bindNeedsReview: false, lastAction: "", lastActionAt: ""
          }).then((saved) => {
            renderRows();
            message(saved ? "Для занятия № " + lesson.number + " разрешена повторная отправка КТП." :
              "Не удалось сохранить снятие блокировки.", !saved);
          });
        }, actionBusy));
      }
      if (!state.graded && (state.gradeAttempted || state.gradeNeedsReview || /^Оценки:/.test(state.lastAction || ""))) {
        actions.append(button("Разрешить повтор оценок", () => {
          if (!window.confirm("Проверьте уже выставленные оценки в БАРС. Разрешить повторную попытку выставления троек в занятии № " +
            lesson.number + " (" + lesson.date + ")? Непустые оценки сохранятся.")) return;
          void storeState(id, {gradeAttempted: false, gradeNeedsReview: false}).then((saved) => {
            renderRows();
            message(saved ? "Повторная попытка оценивания разрешена." : "Не удалось сохранить разрешение.", !saved);
          });
        }, actionBusy));
      }
      if (!state.closed && (state.closeAttempted || state.closeNeedsReview || /^Закрытие:/.test(state.lastAction || ""))) {
        actions.append(button("Проверить закрытие", () =>
          void runLessonAction(journal, lesson, "verifyCloseFinal"), actionBusy || sourceTabId === null));
        actions.append(button("Разрешить повтор закрытия", () => {
          if (!window.confirm("Проверьте состояние занятия № " + lesson.number + " (" + lesson.date +
            ") в БАРС. Разрешить повторный вызов закрытия только если занятие ещё открыто?")) return;
          void storeState(id, {closeAttempted: false, closeNeedsReview: false}).then((saved) => {
            renderRows();
            message(saved ? "Повторная попытка закрытия разрешена." : "Не удалось сохранить разрешение.", !saved);
          });
        }, actionBusy));
      }
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
    if (journal) {
      try {
        const first = collegeLessonBatch.lessonsByDate(journal)[0];
        const suggested = first && plans[String(first.id)]?.ktpNumber;
        if (suggested) ktpStart.value = suggested;
      } catch { /* Недопустимые даты обрабатываются при заполнении. */ }
    }
    renderRows();
  }
  async function refresh() {
    const records = await chrome.storage.local.get(null);
    if (!preferencesLoaded) {
      favoriteIds = Array.isArray(records[favoritesKey])
        ? [...new Set(records[favoritesKey].filter((item) => typeof item === "string"))] : [];
      stopErrorsInput.checked = records[stopErrorsKey] !== false;
      checkpoint = records[checkpointKey] || null;
      preferencesLoaded = true;
    }
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
    renderFavorites();
  }
  stopErrorsInput.addEventListener("change", () => {
    void chrome.storage.local.set({[stopErrorsKey]: stopErrorsInput.checked})
      .catch((error) => { queueStatus.textContent = "Не удалось сохранить настройку: " + error.message; });
  });
  queueClearButton.addEventListener("click", () => {
    if (actionBusy || !window.confirm("Удалить список избранных журналов? Планы и данные БАРС не изменятся.")) return;
    favoriteIds = [];
    void saveFavorites();
  });
  stopAction.addEventListener("click", () => {
    if (sourceTabId === null || !actionBusy) return;
    stopRequested = true;
    message("Остановка запрошена. Уже отправленные изменения в БАРС не отменяются.");
    void chrome.tabs.sendMessage(sourceTabId, {type: "navigateJournalCancel"}).catch(() => {});
    void chrome.scripting.executeScript({target: {tabId: sourceTabId}, world: "MAIN",
      func: () => window.__barsLessonActions?.stop()}).catch((error) => message("Не удалось остановить: " + error.message, true));
  });
  journalSelect.addEventListener("change", () => {
    selectedKey = journalSelect.value;
    ktpStart.value = "";
    batchStatus = null;
    renderBatchProgress();
    void loadPlan();
  });
  async function applySequentialKtp(confirmOverwrite = true) {
    // Изменение поля и нажатие кнопки могут сработать почти одновременно:
    // ждём одну и ту же операцию, чтобы не запустить БАРС до записи плана.
    if (ktpAssignmentPromise) return ktpAssignmentPromise;
    const task = (async () => {
    if (actionBusy) return false;
    const journal = current();
    if (!journal) return false;
    let assignment;
    try {
      assignment = collegeLessonBatch.assignKtpSequence(journal, ktpStart.value);
    } catch (error) {
      message(error.message, true);
      return false;
    }
    const conflicts = assignment.filter(({lesson, ktpNumber}) => {
      const state = stateFor(String(lesson.id));
      return state.ktpNumber && String(state.ktpNumber) !== ktpNumber &&
        (state.linked || state.bindAttempted || state.bindNeedsReview ||
          state.graded || state.gradeAttempted || state.gradeNeedsReview ||
          state.closed || state.closeAttempted || state.closeNeedsReview);
    });
    if (conflicts.length) {
      message("Номера КТП не изменены: " + conflicts.length +
        " занятий уже имеют выполненные или отправленные действия с другими номерами (" +
        conflicts.slice(0, 5).map(({lesson}) => "№ " + lesson.number +
          " / " + lesson.date).join(", ") + "). Проверьте их вручную.", true);
      return false;
    }
    const changed = assignment.filter(({lesson, ktpNumber}) =>
      String(stateFor(String(lesson.id)).ktpNumber || "") !== ktpNumber);
    if (!changed.length) {
      message("Номера тем уже расставлены по датам: " + assignment.length + ".");
      return true;
    }
    if (confirmOverwrite && !window.confirm(
      "Назначить темы КТП по хронологии: от № " + ktpStart.value + " до № " +
      assignment[assignment.length - 1].ktpNumber + " (" + assignment.length +
      " занятий)? Будут заменены " + changed.length + " незавершённых номеров. " +
      "Это пока только локальный план, без записи в БАРС."
    )) return false;
    for (const {lesson, ktpNumber} of assignment) {
      const id = String(lesson.id), state = stateFor(id);
      if (String(state.ktpNumber || "") === ktpNumber) continue;
      plans[id] = {
        ...state, ktpNumber, linked: false, bindAttempted: false,
        bindNeedsReview: false, lastAction: "", lastActionAt: ""
      };
    }
    const saved = await persist();
    renderRows();
    message(saved ? "Назначены темы КТП: " + assignment.map(x => x.ktpNumber).join(", ") + "." :
      "Не удалось сохранить последовательность КТП.", !saved);
    return saved;
    })();
    ktpAssignmentPromise = task;
    try {
      return await task;
    } finally {
      if (ktpAssignmentPromise === task) ktpAssignmentPromise = null;
    }
  }

  numberAll.addEventListener("click", () => void applySequentialKtp());
  ktpStart.addEventListener("change", () => {
    if (ktpStart.value.trim()) void applySequentialKtp();
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
    // Only inject into the existing tab. Never activate that tab or focus its window.
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
    if (action === "grades") {
      patch.gradeAttempted = true;
      patch.gradeNeedsReview = !result.verified;
      if (result.verified) {
        patch.gradesPrepared = true;
        patch.graded = true;
      }
    }
    if (action === "close") {
      patch.closeAttempted = true;
      patch.closeNeedsReview = !result.verified;
      if (result.verified) patch.closed = true;
    }
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
      const saved = action === "verifyCloseFinal"
        ? (!result.ok || !result.verified ? true : await saveActionOutcome(lesson, "close", result))
        : await saveActionOutcome(lesson, action, result);
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

  batchBindButton.addEventListener("click", () => {
    void runBatchBinding().catch((error) => message("Ошибка пакетной привязки КТП: " + error.message, true));
  });

  async function runBatchDelayedClose(journal, plan, label, priorPending = null) {
    actionBusy = true;
    stopRequested = false;
    const totalToVerify = plan.queue.length + (priorPending ? 1 : 0);
    batchStatus = {
      completed: 0, total: totalToVerify,
      text: "Закрытие: новых запросов 0 из " + plan.queue.length +
        ", подтверждено 0 из " + totalToVerify + "."
    };
    renderRows();
    try {
      const result = await collegeLessonBatch.runDelayedClose(plan.queue, {
        initialPending: priorPending,
        stopped: () => stopRequested,
        async beforeSubmit(lesson, {submitted}) {
          const id = String(lesson.id);
          batchStatus.text = "Отправляем закрытие " + (submitted + 1) + " из " +
            plan.queue.length + ": занятие № " + lesson.number + " (" + lesson.date + ").";
          renderBatchProgress();
          return storeState(id, {
            closeAttempted: true, closeNeedsReview: true,
            lastAction: "Закрытие: ожидает проверки после следующего занятия",
            lastActionAt: new Date().toISOString()
          });
        },
        submit: (lesson) => executeLessonOperation(journal, lesson, "closeBatch"),
        onSubmitted: (lesson) => storeState(String(lesson.id), {
          closeAttempted: true, closeNeedsReview: true,
          lastAction: "Закрытие: запрос отправлен, ждём проверки",
          lastActionAt: new Date().toISOString()
        }),
        verify: (lesson, final) => executeLessonOperation(journal, lesson,
          final ? "verifyCloseFinal" : "verifyClose"),
        onVerified: (lesson, check) => saveActionOutcome(lesson, "close", check),
        onUnverified: (lesson, check) => storeState(String(lesson.id), {
          closeAttempted: true, closeNeedsReview: true,
          lastAction: "Закрытие: не подтверждено, проверьте в БАРС",
          lastActionAt: new Date().toISOString()
        }),
        onError: (lesson, error) => storeState(String(lesson.id), {
          closeAttempted: true, closeNeedsReview: true,
          lastAction: "Закрытие: неизвестный результат, проверьте в БАРС",
          lastActionAt: new Date().toISOString()
        }),
        async progress({submitted, verified, previous}) {
          batchStatus.completed = verified;
          batchStatus.text = "Закрытие: новых запросов " + submitted + " из " +
            plan.queue.length + ", подтверждено " + verified + " из " +
            totalToVerify + ". Занятие № " + previous.number +
            " ожидает следующего закрытия.";
          renderRows();
          message(batchStatus.text);
        }
      });
      batchStatus.completed = result.verified;
      const prefix = "Закрытие: новых запросов " + result.submitted + " из " +
        plan.queue.length + ", подтверждено " + result.verified +
        " из " + totalToVerify + ". ";
      const final = result.reason
        ? "Очередь остановлена: " + result.reason +
          " Непроверенные занятия не будут отправлены повторно автоматически."
        : result.pending
          ? "Последнее занятие № " + result.pending.number + " (" +
            result.pending.date + ") пока не подтверждено. Откройте БАРС и нажмите " +
            "«Проверить закрытие» в этой строке после обновления статуса."
          : "Все отправленные закрытия подтверждены интерфейсом БАРС.";
      batchStatus.text = prefix + final;
      message(batchStatus.text, Boolean(result.reason));
    } catch (error) {
      batchStatus.text = "Ошибка пакетного закрытия: " + error.message +
        ". Ранее отправленные занятия нужно проверить вручную.";
      message(batchStatus.text, true);
    } finally {
      actionBusy = false;
      stopRequested = false;
      renderRows();
    }
  }

  async function runBatchWrite(action) {
    if (actionBusy) return;
    const journal = current();
    if (!journal || sourceTabId === null) {
      message("Выберите журнал и откройте дашборд из вкладки колледжа.", true);
      return;
    }
    const grading = action === "grades";
    const label = grading ? "Выставить всем «3» по всем занятиям" : "Закрыть все занятия";
    let plan;
    try {
      plan = grading ? collegeLessonBatch.prepareGrades(journal, plans)
        : collegeLessonBatch.prepareClose(journal, plans);
    } catch (error) {
      message(error.message, true);
      return;
    }
    // Одно ранее отправленное закрытие может ожидать подтверждения
    // ровно до следующей записи. Его нельзя отправлять повторно.
    const priorPending = grading ? null : collegeLessonBatch.resumableClose(plan, plans);
    const otherPending = plan.attempted.length + plan.unresolved.length - (priorPending ? 1 : 0);
    // Closing is consequential: остальные непроверенные/неподготовленные занятия блокируют очередь.
    if (!grading && (plan.blocked.length || otherPending)) {
      const preview = plan.blocked.slice(0, 5).map(({lesson, needsKtp, needsGrades}) =>
        "№ " + lesson.number + " / " + lesson.date + " (" +
        [needsKtp ? "КТП" : "", needsGrades ? "оценки" : ""].filter(Boolean).join(" и ") + ")").join(", ");
      message("Массовое закрытие не запущено. Не подтверждены предыдущие этапы: " +
        plan.blocked.length + (preview ? " — " + preview : "") +
        ". Закрытие уже отправлялось, требует проверки: " +
        otherPending +
        ". Проверьте БАРС и подтвердите завершённые этапы по строкам.", true);
      return;
    }
    if (!plan.queue.length) {
      message("Новых занятий для операции «" + label + "» нет. Подтверждено ранее: " +
        plan.completed.length + ", требует проверки: " +
        (plan.attempted.length + plan.unresolved.length) + ".", false);
      return;
    }
    const excluded = grading ? "Уже закрыто: " + plan.closed.length + ". " : "";
    const prompt = (grading
      ? "Выставить оценку «3» всем студентам в " + plan.queue.length +
        " занятиях выбранного журнала? Уже заполненные оценки не изменятся.\n\n"
      : "Закрыть " + plan.queue.length +
        " занятий выбранного журнала? Это изменяет статус занятий на сервере БАРС.\n\n") +
      "Журнал: " + title(journal) + ".\n" +
      "Занятий всего: " + plan.total + ". Уже подтверждено: " + plan.completed.length +
      ". " + excluded + "Ранее отправлялось или требует проверки: " +
      (plan.attempted.length + plan.unresolved.length) +
      (priorPending ? ". Продолжим с проверкой уже отправленного занятия № " +
        priorPending.number + " после нового закрытия (без повторной отправки)." : "") + ".\n\n" +
      "Действия выполняются по очереди без переключения вкладки. " +
      (grading ? "При ошибке или неподтверждённом результате выполнение остановится."
        : "После каждого следующего закрытия будет проверено предыдущее занятие. " +
          "Последнее будет повторно проверено после обновления журнала; оно может остаться неподтверждённым.");
    if (!window.confirm(prompt)) return;
    if (!grading) {
      await runBatchDelayedClose(journal, plan, label, priorPending);
      return;
    }

    actionBusy = true;
    stopRequested = false;
    let completed = 0;
    let reason = "";
    batchStatus = {completed: 0, total: plan.queue.length,
      text: label + ": 0 из " + plan.queue.length + "."};
    renderRows();
    try {
      for (const lesson of plan.queue) {
        if (stopRequested) {
          reason = "Остановка запрошена пользователем.";
          break;
        }
        const id = String(lesson.id);
        const position = completed + 1;
        batchStatus.text = label + ": " + position + " из " + plan.queue.length +
          ". Занятие № " + lesson.number + " (" + lesson.date + ").";
        renderBatchProgress();
        // Record intent before the first server mutation. On interruptions a
        // later run will not repeat an uncertain write automatically.
        const intent = await storeState(id, grading
          ? {gradeAttempted: true, gradeNeedsReview: true}
          : {closeAttempted: true, closeNeedsReview: true});
        if (!intent) {
          reason = "Не удалось сохранить защитную отметку для занятия № " +
            lesson.number + "; пакет остановлен до отправки запроса.";
          break;
        }
        let result;
        try {
          result = await executeLessonOperation(journal, lesson, action);
        } catch (error) {
          result = {ok: false, verified: false, message: error.message};
        }
        if (!result.ok) {
          const saved = await storeState(id, {
            lastAction: (grading ? "Оценки" : "Закрытие") + ": проверить после ошибки",
            lastActionAt: new Date().toISOString()
          });
          reason = "Остановлено на занятии № " + lesson.number + " (" + lesson.date +
            "): " + result.message + (saved ? " Проверьте результат на сайте перед повтором." :
              " Локальная отметка ошибки не сохранилась.");
          break;
        }
        const saved = await saveActionOutcome(lesson, action, result);
        if (!saved) {
          reason = "Действие по занятию № " + lesson.number +
            " отправлено, но локальный результат не сохранился. Проверьте БАРС перед повтором.";
          break;
        }
        if (!result.verified) {
          reason = "Остановлено на занятии № " + lesson.number + " (" + lesson.date +
            "): результат не подтверждён. " + result.message +
            " Проверьте состояние в БАРС, затем подтвердите или разрешите повтор в этой строке.";
          break;
        }
        completed++;
        batchStatus.completed = completed;
        batchStatus.text = label + ": " + completed + " из " +
          plan.queue.length + ". Проверено занятие № " + lesson.number + " (" + lesson.date + ").";
        renderRows();
        message(batchStatus.text);
      }
    } catch (error) {
      reason = "Пакет остановлен: " + error.message;
    } finally {
      actionBusy = false;
      stopRequested = false;
      const done = completed === plan.queue.length && !reason;
      batchStatus.text = (done ? "Завершено. " : "Остановлено. ") +
        label + ": " + completed + " из " + plan.queue.length +
        (reason ? ". " + reason : ". Все обработанные занятия прошли проверку.");
      renderRows();
      message(batchStatus.text, !done);
    }
  }

  async function runFullJournalByDates(options = {}) {
    const fromQueue = options.fromQueue === true;
    const stopOnError = options.stopOnError ?? stopErrorsInput.checked;
    if (actionBusy && !fromQueue) return {ok: false, reason: "Уже выполняется другое действие."};
    const journal = current();
    if (!journal || sourceTabId === null) {
      const reason = "Выберите журнал и откройте дашборд из вкладки БАРС.";
      message(reason, true);
      return {ok: false, reason};
    }
    if (!fromQueue && ktpStart.value.trim()) {
      if (!await applySequentialKtp()) return {ok: false, reason: "Не удалось назначить номера КТП."};
    }
    let plan;
    try { plan = collegeLessonBatch.prepareFull(journal, plans); }
    catch (error) {
      message(error.message, true);
      return {ok: false, reason: error.message};
    }
    const excluded = plan.problems.map(({lesson, reason}) =>
      "№ " + lesson.number + " (" + lesson.date + "): " + reason);
    if (excluded.length && stopOnError) {
      const reason = "Перед запуском обнаружено " + excluded.length +
        " непроверенных занятий: " + excluded.slice(0, 5).join("; ") +
        ". Сверьте их в БАРС либо отключите остановку при ошибках, чтобы пропустить.";
      message(reason, true);
      return {ok: false, reason, problems: excluded.length};
    }
    if (!plan.queue.length) {
      const reason = plan.problems.length
        ? "Все оставшиеся даты требуют проверки: " + excluded.slice(0, 5).join("; ")
        : "Все занятия журнала уже отмечены закрытыми.";
      message(reason, plan.problems.length > 0);
      return {ok: !plan.problems.length, skipped: true, problems: plan.problems.length,
        reason, processed: 0, issues: plan.problems.length, pending: 0};
    }
    if (!fromQueue) {
      const prompt = "ЗАПОЛНИТЬ ЖУРНАЛ ПО ДАТАМ?\n\n" + title(journal) +
        "\nДля обработки: " + plan.queue.length + " из " + plan.total + ".\n" +
        "Последовательно: КТП → «3» → закрытие → обновление → проверка.\n" +
        (stopOnError ? "При ошибке выполнение остановится." :
          "При ошибке запись будет отмечена и пропущена без повторной отправки; следующие даты продолжатся.") +
        (excluded.length ? "\nБудут пропущены " + excluded.length +
          " ранее отправленных или неподготовленных занятий." : "") +
        "\nВкладка БАРС останется фоновой.";
      if (!window.confirm(prompt)) return {cancelled: true};
      actionBusy = true;
      stopRequested = false;
    }
    batchStatus = {
      total: plan.queue.length, completed: 0,
      text: "Заполнение журнала по датам: 0 из " + plan.queue.length + "."
    };
    renderRows();

    const stages = {
      bind: "привязка КТП", grades: "всем «3»", close: "закрытие",
      refresh: "обновление и проверка", done: "дата обработана", skipped: "дата пропущена"
    };
    const failState = async (lesson, stage) => {
      const id = String(lesson.id), prefix = stage === "bind" ? "КТП" :
        stage === "grades" ? "Оценки" : "Закрытие";
      const patch = {
        lastAction: prefix + ": результат неизвестен, проверьте в БАРС",
        lastActionAt: new Date().toISOString()
      };
      if (stage === "bind") Object.assign(patch,
        {bindAttempted: true, bindNeedsReview: true});
      if (stage === "grades") Object.assign(patch,
        {gradeAttempted: true, gradeNeedsReview: true});
      if (stage === "close") Object.assign(patch,
        {closeAttempted: true, closeNeedsReview: true});
      return storeState(id, patch);
    };
    let response;
    try {
      const summary = await collegeLessonBatch.runFillDates(plan.queue, {
        stopOnError,
        stopped: () => stopRequested,
        needed: (lesson, stage) => {
          const state = stateFor(String(lesson.id));
          return stage === "bind" ? !state.linked :
            stage === "grades" ? !state.graded : !state.closed;
        },
        async perform(lesson, stage) {
          const id = String(lesson.id);
          const intent = stage === "bind"
            ? {bindAttempted: true, bindNeedsReview: true, lastAction: "КТП: отправляется"}
            : stage === "grades"
              ? {gradeAttempted: true, gradeNeedsReview: true, lastAction: "Оценки: выставляются"}
              : {closeAttempted: true, closeNeedsReview: true, lastAction: "Закрытие: отправляется"};
          if (!await storeState(id, {...intent, lastActionAt: new Date().toISOString()})) {
            return {ok: false, fatal: true,
              message: "Не удалось записать защитную отметку до изменения БАРС."};
          }
          let result;
          try {
            result = await executeLessonOperation(journal, lesson,
              stage === "close" ? "closeBatch" : stage);
          } catch (error) {
            result = {ok: false, verified: false, message: error.message};
          }
          if (!result.ok) {
            const saved = await failState(lesson, stage);
            return saved ? result : {...result, fatal: true};
          }
          let saved;
          if (stage === "bind") {
            saved = await storeState(id, {
              bindAttempted: true, bindNeedsReview: !result.verified,
              ...(result.verified ? {linked: true} : {}),
              lastAction: result.verified ? "КТП: подтверждено" :
                "КТП: запрос отправлен, требуется проверка",
              lastActionAt: new Date().toISOString()
            });
          } else if (stage === "grades") {
            saved = await saveActionOutcome(lesson, "grades", result);
          } else {
            saved = await storeState(id, {
              closeAttempted: true, closeNeedsReview: true,
              lastAction: "Закрытие: отправлено, ждём обновления",
              lastActionAt: new Date().toISOString()
            });
          }
          return saved ? result : {ok: false, fatal: true,
            message: "БАРС обработал действие, но локальная отметка не сохранилась."};
        },
        async verify(lesson, final) {
          const id = String(lesson.id);
          let result;
          try {
            result = await executeLessonOperation(journal, lesson,
              final ? "verifyCloseFinal" : "verifyClose");
          } catch (error) {
            result = {ok: false, verified: false, message: error.message};
          }
          const patch = result.ok && result.verified
            ? {closeAttempted: true, closeNeedsReview: false, closed: true,
              lastAction: "Закрытие: подтверждено", lastActionAt: new Date().toISOString()}
            : {closeAttempted: true, closeNeedsReview: true,
              lastAction: "Закрытие: ожидает подтверждения в БАРС",
              lastActionAt: new Date().toISOString()};
          const saved = await storeState(id, patch);
          return saved ? result : {ok: false, fatal: true,
            message: "Не удалось сохранить итог проверки закрытия."};
        },
        async progress({lesson, stage, processed, verifiedClose, skipped, pending}) {
          batchStatus.completed = processed;
          batchStatus.text = (queueRunActive ? queueRunLabel + ". " : "") +
            "По датам: " + processed + " из " + plan.queue.length +
            ". Текущее занятие № " + lesson.number + " (" + lesson.date +
            "), этап: " + (stages[stage] || stage) +
            ". Закрытий подтверждено: " + verifiedClose +
            ". Пропущено из-за ошибок: " + (skipped || 0) +
            ". Ожидают закрытия: " + (pending?.length || 0) + ".";
          renderBatchProgress();
          if (stage === "done" || stage === "skipped") renderRows();
          message(batchStatus.text);
        }
      });
      const issueCount = excluded.length + summary.issues.length;
      const waiting = summary.pendingLessons.length;
      const complete = !summary.reason && !issueCount && !waiting &&
        summary.processed === plan.queue.length;
      batchStatus.completed = summary.processed;
      batchStatus.text = (summary.reason ? "ОСТАНОВЛЕНО. " :
        complete ? "ВЫПОЛНЕНО. " : "ОБРАБОТАНО С ЗАМЕЧАНИЯМИ. ") +
        "Дат: " + summary.processed + " из " + plan.queue.length +
        ", пропущено из-за ошибок: " + summary.skipped +
        ", требует проверки: " + issueCount +
        ", не подтверждено закрытий: " + waiting + ". " +
        (summary.reason || (waiting
          ? "Проверьте ожидающие закрытия через кнопку «Проверить закрытие» без повторного закрытия."
          : "Факт отправки КТП не равнозначен проверенной привязке."));
      message(batchStatus.text, Boolean(summary.reason || issueCount || waiting));
      response = {
        ok: complete, processed: summary.processed, verifiedClose: summary.verifiedClose,
        issues: issueCount, pending: waiting, skipped: summary.skipped,
        reason: summary.reason, total: plan.queue.length
      };
    } catch (error) {
      batchStatus.text = "Автозаполнение остановлено: " + error.message +
        ". Проверьте уже выполненные даты.";
      message(batchStatus.text, true);
      response = {ok: false, reason: error.message, fatal: true};
    } finally {
      if (!fromQueue) {
        actionBusy = false;
        stopRequested = false;
      }
      renderRows();
    }
    return response;
  }

  async function navigateQueueJournal(journal) {
    if (sourceTabId === null) throw new Error("Не найдена исходная вкладка БАРС.");
    const target = {tabId: sourceTabId};
    // Повторно используем механизм автоматического выбора Ext JS-комбобоксов
    // из collector.js и journal-page.js. Фокус вкладки не переключается.
    await chrome.scripting.executeScript({target, world: "MAIN", files: ["journal-page.js"]});
    await chrome.scripting.executeScript({target, files: ["collector.js"]});
    const result = await chrome.tabs.sendMessage(sourceTabId, {
      type: "navigateJournal",
      journal: {
        origin: journal.origin,
        period: journal.period,
        group: journal.group,
        subject: journal.subject,
        kind: journal.kind || "theoretical",
        lessonIds: journal.lessons.map(({id}) => String(id)),
        lessons: journal.lessons.map(({id, date}) => ({id: String(id), date: String(date)}))
      }
    });
    if (!result?.ok) throw new Error(result?.error || "Не удалось открыть журнал очереди.");
    return result.journal;
  }

  async function runFavoriteJournalQueue() {
    if (actionBusy) return;
    if (sourceTabId === null) {
      queueStatus.textContent = "Откройте дашборд из вкладки БАРС.";
      return;
    }
    const lookup = new Map(journals.map((journal) => [journalIdentity(journal), journal]));
    const missing = favoriteIds.filter((id) => !lookup.has(id));
    if (missing.length) {
      queueStatus.textContent = "В очереди есть " + missing.length +
        " журналов, отсутствующих в текущей базе. Пересоберите их или очистите избранное.";
      return;
    }
    const queue = favoriteIds.map((id) => lookup.get(id));
    if (!queue.length) {
      queueStatus.textContent = "Отметьте нужные журналы галочками в списке избранных.";
      return;
    }
    const stopOnError = stopErrorsInput.checked;
    if (!window.confirm("Запустить заполнение очереди из " + queue.length +
      " избранных журналов?\n\nВ каждом журнале будут обработаны даты с уже назначенными " +
      "номерами КТП: привязка → «3» → закрытие → обновление → проверка.\n" +
      "Группа, тип журнала и дисциплина будут переключаться автоматически.\n" +
      (stopOnError
        ? "Режим: остановка при ошибке или неподтверждённой операции."
        : "Режим: записывать ошибки и пропускать проблемные занятия, продолжать следующие журналы.") +
      "\n\nОтправленные изменения нельзя отменить кнопкой «Остановить».")) return;
    actionBusy = true;
    queueRunActive = true;
    stopRequested = false;
    queueLogs = [];
    queueStatus.textContent = "Очередь запущена: 0 из " + queue.length + " журналов.";
    renderQueueResults();
    renderRows();
    let finished = 0;
    let stoppedReason = "";
    try {
      for (const journal of queue) {
        if (stopRequested) {
          stoppedReason = "Остановлено пользователем.";
          break;
        }
        const position = finished + 1;
        queueRunLabel = "Журнал " + position + "/" + queue.length + ": " + title(journal);
        queueStatus.textContent = "Открываем " + queueRunLabel;
        selectedKey = journal.key;
        journalSelect.value = selectedKey;
        ktpStart.value = "";
        await loadPlan();
        let outcome;
        try {
          await navigateQueueJournal(journal);
          if (stopRequested) {
            stoppedReason = "Остановлено пользователем.";
            break;
          }
          outcome = await runFullJournalByDates({fromQueue: true, stopOnError});
        } catch (error) {
          outcome = {ok: false, fatal: false, reason: error.message,
            processed: 0, issues: 1, pending: 0};
        }
        const issues = Number(outcome?.issues || 0), pending = Number(outcome?.pending || 0);
        const record = (outcome?.ok ? "Завершён" : "Требует проверки") + " — " +
          title(journal) + ". Дат обработано: " + (outcome?.processed ?? 0) +
          ", ошибок/пропусков: " + issues + ", ожидают закрытия: " + pending +
          (outcome?.reason ? ". " + outcome.reason : "");
        queueLogs.push(record);
        finished++;
        renderQueueResults();
        queueStatus.textContent = "Очередь: " + finished + " из " + queue.length +
          " журналов. " + (outcome?.ok ? "Без замечаний." : "Есть замечания.");
        if (stopRequested) {
          stoppedReason = "Остановлено пользователем.";
          break;
        }
        if (outcome?.fatal || stopOnError && !outcome?.ok) {
          stoppedReason = "Остановлено на журнале: " + title(journal) +
            ". " + (outcome?.reason || "Нужно проверить результат в БАРС.");
          break;
        }
      }
      queueStatus.textContent = (stoppedReason ? "ОЧЕРЕДЬ ОСТАНОВЛЕНА. " : "ОЧЕРЕДЬ ЗАВЕРШЕНА. ") +
        "Обработано журналов: " + finished + " из " + queue.length +
        ". Журналов с замечаниями: " +
        queueLogs.filter((entry) => entry.startsWith("Требует проверки")).length +
        "." + (stoppedReason ? " " + stoppedReason : "");
    } catch (error) {
      queueStatus.textContent = "Ошибка очереди: " + error.message +
        ". Проверьте отправленные записи в БАРС.";
    } finally {
      queueRunActive = false;
      queueRunLabel = "";
      actionBusy = false;
      stopRequested = false;
      renderRows();
      // Во время записи блокируем реакцию на события storage.onChanged,
      // теперь безопасно перечитать список журналов и последний план.
      await refresh().catch((error) => {
        queueStatus.textContent += " Не удалось обновить список: " + error.message;
      });
    }
  }

  queueRunButton.addEventListener("click", () => {
    void runFavoriteJournalQueue().catch((error) => {
      queueStatus.textContent = "Ошибка очереди журналов: " + error.message;
      actionBusy = false;
      queueRunActive = false;
      renderRows();
    });
  });

  fullDatesButton.addEventListener("click", () => {
    void runFullJournalByDates().catch((error) => message("Ошибка заполнения журнала по датам: " + error.message, true));
  });

  batchGradesButton.addEventListener("click", () => {
    void runBatchWrite("grades").catch((error) => message("Ошибка массового выставления оценок: " + error.message, true));
  });
  batchCloseButton.addEventListener("click", () => {
    void runBatchWrite("close").catch((error) => message("Ошибка массового закрытия: " + error.message, true));
  });



  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || saving || actionBusy) return;
    if (changes["dashboard:cleared-at"]) {
      favoriteIds = [];
      stopErrorsInput.checked = true;
      queueLogs = [];
      renderQueueResults();
    }
    if (changes[favoritesKey]) {
      favoriteIds = Array.isArray(changes[favoritesKey].newValue)
        ? [...new Set(changes[favoritesKey].newValue)] : [];
      renderFavorites();
    }
    if (changes[stopErrorsKey]) {
      stopErrorsInput.checked = changes[stopErrorsKey].newValue !== false;
    }
    const keys = Object.keys(changes);
    if (keys.some((key) => key.startsWith("journal:") || key === keyFor(selectedKey) || key === "dashboard:cleared-at")) {
      void refresh().catch((error) => message(error.message, true));
    }
  });
  void refresh().catch((error) => message("Ошибка загрузки: " + error.message, true));
})();
