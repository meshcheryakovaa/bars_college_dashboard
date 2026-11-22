/* План заполнения журнала. Данные плана локальные; запись в БАРС выполняет пользователь. */
(() => {
  "use strict";
  const prefix = "workflow:plan:";
  const journalSelect = document.querySelector("#workflow-journal");
  const body = document.querySelector("#workflow-rows");
  const status = document.querySelector("#workflow-status");
  const summary = document.querySelector("#workflow-summary");
  const numberAll = document.querySelector("#workflow-number-all");
  const resetPlan = document.querySelector("#workflow-reset");
  const selection = document.querySelector("#workflow-select");
  const source = new URLSearchParams(location.search).get("sourceTab");
  const sourceTabId = /^\d+$/.test(source || "") ? Number(source) : null;
  let journals = [];
  let selectedKey = "";
  let plans = {};
  let saving = false;

  const keyFor = (key) => prefix + key;
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
      closed: ids.filter((id) => stateFor(id).closed).length
    };
  }
  async function persist() {
    if (!selectedKey) return;
    saving = true;
    try {
      await chrome.storage.local.set({[keyFor(selectedKey)]: {version: 1, entries: structuredClone(plans), updatedAt: Date.now()}});
      message("План сохранён локально. Изменения ещё не отправлены в БАРС.");
    } catch (error) {
      message("Не удалось сохранить план: " + error.message, true);
    } finally {
      saving = false;
    }
  }
  function renderRows() {
    body.replaceChildren();
    const journal = current();
    if (!journal) {
      summary.textContent = "Выберите собранный журнал.";
      numberAll.disabled = resetPlan.disabled = true;
      return;
    }
    numberAll.disabled = resetPlan.disabled = false;
    const c = count(journal);
    summary.textContent = "Занятий: " + c.total + " · КТП подтверждено: " + c.linked
      + " · Оценки подтверждены: " + c.graded + " · Закрытие подтверждено: " + c.closed
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
      entry.setAttribute("aria-label", "№ КТП для " + lesson.date + ", занятие " + lesson.number);
      entry.addEventListener("change", async () => {
        const value = entry.value.trim();
        if (!validNumber(value)) {
          entry.setCustomValidity("Укажите целое число от 1 до 9999.");
          entry.reportValidity();
          return;
        }
        entry.setCustomValidity("");
        await storeState(id, {ktpNumber: value, linked: false, closed: false});
        renderRows();
      });
      makeCell(row, entry);
      const grade = document.createElement("div");
      grade.className = "workflow-score";
      grade.append(document.createTextNode("«3» × " + journal.students.length));
      const prepared = checkbox("Подготовлено", Boolean(state.gradesPrepared),
        (checked) => { void storeState(id, {gradesPrepared: checked, graded: false, closed: false}).then(renderRows); });
      grade.append(prepared);
      makeCell(row, grade);
      const checks = document.createElement("div");
      checks.className = "workflow-checks";
      checks.append(
        checkbox("КТП привязано", Boolean(state.linked), (checked) => {
          void storeState(id, {linked: checked, closed: false}).then(renderRows);
        }, !state.ktpNumber),
        checkbox("Тройки внесены", Boolean(state.graded), (checked) => {
          void storeState(id, {graded: checked, closed: false}).then(renderRows);
        }, !state.gradesPrepared),
        checkbox("Занятие закрыто", Boolean(state.closed), (checked) => {
          if (checked && !window.confirm("Подтвердите, что занятие действительно закрыто в БАРС. Дашборд сам не меняет статус на сервере.")) {
            renderRows();
            return;
          }
          void storeState(id, {closed: checked}).then(renderRows);
        }, !state.linked || !state.graded)
      );
      makeCell(row, checks);
      const actions = document.createElement("div");
      actions.className = "workflow-actions";
      actions.append(
        button("КТП", () => void openLesson(journal, lesson, "ktp"), sourceTabId === null),
        button("Оценки", () => void openLesson(journal, lesson, "grades"), sourceTabId === null),
        button("Закрытие", () => void openLesson(journal, lesson, "close"), sourceTabId === null)
      );
      makeCell(row, actions);
      body.append(row);
    }
  }
  async function loadPlan() {
    plans = {};
    const journal = current();
    if (journal) {
      const saved = await chrome.storage.local.get(keyFor(selectedKey));
      if (current()?.key !== journal.key) return;
      plans = saved[keyFor(selectedKey)]?.entries || {};
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

  // Встраиваемая навигация ничего не записывает на сервер: только сверяет и подсвечивает колонку.
  async function openLesson(journal, lesson, mode) {
    if (sourceTabId === null) {
      message("Откройте дашборд из меню расширения на вкладке Электронного колледжа.", true);
      return;
    }
    const ktp = stateFor(String(lesson.id)).ktpNumber || "";
    try {
      const tab = await chrome.tabs.update(sourceTabId, {active: true});
      await chrome.windows.update(tab.windowId, {focused: true});
      const result = await chrome.scripting.executeScript({
        target: {tabId: sourceTabId},
        func: (expected, target, action, number) => {
          const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();
          const visible = (node) => Boolean(node && node.getClientRects().length);
          const compact = (v) => clean(v).replace(/\s[-–—]\s\d+\s+курс$/i, "");
          const windows = [...document.querySelectorAll(".x-window")]
            .filter((node) => visible(node) && /^Журнал (теоретических|практических) занятий/.test(
              clean(node.querySelector(".x-window-header-text")?.textContent)))
            .sort((a, b) => (Number(b.style.zIndex) || 0) - (Number(a.style.zIndex) || 0));
          const journalWindow = windows.find((node) => {
            const practical = clean(node.querySelector(".x-window-header-text")?.textContent).includes("практических");
            if (practical !== expected.practical) return false;
            const field = (label) => [...node.querySelectorAll(".x-form-item")].find((item) =>
              [...item.querySelectorAll("label")].some((el) => clean(el.textContent).replace(/[:*]/g, "") === label))
              ?.querySelector('input[type="text"]')?.value;
            return compact(field("Группа")) === compact(expected.group) && clean(field("Предмет")) === clean(expected.subject);
          });
          if (!journalWindow) return {
            ok: false, message: "Откройте нужный тип журнала, группу «" + expected.group + "» и предмет «"
              + expected.subject + "» на вкладке «Журнал», затем повторите."
          };
          const tabActive = [...journalWindow.querySelectorAll(".x-tab-strip-active .x-tab-strip-text")]
            .some((node) => clean(node.textContent) === "Журнал");
          if (!tabActive) return {ok: false, message: "Переключитесь на вкладку «Журнал» и повторите."};
          const grids = [...journalWindow.querySelectorAll(".x-grid3")].filter((node) =>
            visible(node) && node.querySelector(".x-grid3-locked") && node.querySelector(".x-grid3-unlocked"));
          if (grids.length !== 1) return {ok: false, message: "Не найдена одна готовая таблица журнала."};
          const grid = grids[0], right = grid.querySelector(".x-grid3-unlocked");
          const first = right.querySelector(".x-grid3-body > .x-grid3-row");
          const columnKey = (node) => [...node.classList].find((name) => name.startsWith("x-grid3-td-"));
          if (!first) return {ok: false, message: "Таблица пока не загрузилась."};
          const byKey = new Map([...first.querySelectorAll("td.x-grid3-cell")].filter(
            (node) => node.style.display === "none").map((node) => [columnKey(node), clean(node.textContent)]));
          const headers = [...right.querySelectorAll(".x-grid3-header .x-grid3-gcell")];
          const matching = headers.filter((header) => byKey.get(columnKey(header)) === String(target.id));
          if (matching.length !== 1) return {
            ok: false, message: "Не получилось однозначно найти ID занятия " + target.id
              + " в открытом журнале. Обновите сбор данных."
          };
          const header = matching[0];
          header.scrollIntoView({block: "center", inline: "center", behavior: "instant"});
          header.style.outline = "3px solid #c27818";
          header.style.outlineOffset = "-3px";
          const id = "bars-workflow-guide";
          document.getElementById(id)?.remove();
          const notice = document.createElement("div");
          notice.id = id;
          notice.setAttribute("role", "status");
          Object.assign(notice.style, {position: "fixed", zIndex: "2147483647", top: "16px", right: "16px",
            maxWidth: "380px", padding: "14px 16px", background: "#fff", color: "#16343f",
            border: "2px solid #c27818", borderRadius: "9px", font: "14px system-ui",
            boxShadow: "0 8px 30px #0003"});
          const caption = document.createElement("strong");
          caption.textContent = "Занятие " + target.number + " · " + target.date;
          const text = document.createElement("p");
          text.textContent = action === "ktp" ? "Привяжите через штатное окно КТП тему № " + (number || "(не указан)")
            : action === "grades" ? "Выставьте оценки «3» студентам через штатные ячейки БАРС."
              : "Закройте занятие через штатную команду БАРС после сохранения оценок.";
          const dismiss = document.createElement("button");
          dismiss.type = "button";
          dismiss.textContent = "Понятно";
          dismiss.style.cssText = "padding:6px 10px;cursor:pointer";
          dismiss.addEventListener("click", () => {notice.remove(); header.style.outline = "";});
          notice.append(caption, text, dismiss);
          document.body.append(notice);
          return {ok: true, message: "Найден и подсвечен столбец занятия " + target.number + " (" + target.date + ")."};
        },
        args: [{
          group: journal.group, subject: journal.subject, practical: journal.kind === "practical"
        }, {id: lesson.id, date: lesson.date, number: lesson.number}, mode, ktp]
      });
      const data = result?.[0]?.result;
      message(data?.message || "Не удалось открыть выбранное занятие.", !data?.ok);
    } catch (error) {
      message("Не удалось обратиться к вкладке БАРС: " + error.message, true);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || saving) return;
    const keys = Object.keys(changes);
    if (keys.some((key) => key.startsWith("journal:") || key === keyFor(selectedKey) || key === "dashboard:cleared-at")) {
      void refresh().catch((error) => message(error.message, true));
    }
  });
  void refresh().catch((error) => message("Ошибка загрузки: " + error.message, true));
})();
