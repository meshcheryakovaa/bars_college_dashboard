/* Запись через штатные Ext JS обработчики БАРС, без прямых запросов к API. */
(() => {
  "use strict";
  if (window.__barsLessonActions?.version === 5) return;
  const clean = (x) => String(x ?? "").replace(/\s+/g, " ").trim();
  const shown = (x) => Boolean(x?.isConnected && x.getClientRects().length);
  const cells = (row) => [...row.querySelectorAll("td.x-grid3-cell")];
  const key = (element) => [...(element?.classList || [])].find((value) => value.startsWith("x-grid3-td-"));
  const headerPattern = /^\((\d+)\)\s*[-–—]\s*(\d{1,2}\.\d{2}(?:\.\d{2,4})?)/;
  const latest = (items) => [...items].sort((a, b) => (Number(b.style.zIndex) || 0) - (Number(a.style.zIndex) || 0));
  let running = false;
  let stopRequested = false;

  function assert(cond, message) {
    if (!cond) throw new Error(message);
  }
  function check() {
    if (stopRequested) throw new Error("Операция остановлена.");
  }
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  async function until(probe, timeout = 15000, reason = "БАРС не ответил вовремя.") {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      check();
      const result = probe();
      if (result) return result;
      await sleep(150);
    }
    throw new Error(reason);
  }
  const windows = () => latest(document.querySelectorAll(".x-window")).filter(shown);
  const windowTitle = (win) => clean(win.querySelector(".x-window-header-text")?.textContent);
  function field(win, label) {
    const normalized = label.replace(/[:*]/g, "");
    const nodes = [...win.querySelectorAll(".x-form-item")].filter(shown);
    const match = nodes.find((node) => [...node.querySelectorAll("label")].some(
      (caption) => clean(caption.textContent).replace(/[:*]/g, "") === normalized));
    return clean(match?.querySelector('input[type="text"]')?.value);
  }
  function scope(task) {
    assert(location.origin === task.origin, "Открыта другая образовательная система.");
    const win = windows().find((node) => {
      const label = windowTitle(node);
      return label.startsWith(task.practical ? "Журнал практических занятий" : "Журнал теоретических занятий")
        && field(node, "Группа").replace(/\s[-–—]\s\d+\s+курс$/i, "") ===
          clean(task.group).replace(/\s[-–—]\s\d+\s+курс$/i, "")
        && field(node, "Предмет") === clean(task.subject);
    });
    assert(win, "Сначала откройте в БАРС нужный тип журнала, группу и дисциплину.");
    assert([...win.querySelectorAll(".x-tab-strip-active .x-tab-strip-text")].some(
      (node) => clean(node.textContent) === "Журнал"), "Переключитесь на вкладку «Журнал».");
    const grids = [...win.querySelectorAll(".x-grid3")].filter(
      (node) => shown(node) && node.querySelector(".x-grid3-locked") && node.querySelector(".x-grid3-unlocked"));
    assert(grids.length === 1, "Таблица журнала не готова или определилась неоднозначно.");
    const grid = grids[0];
    const right = grid.querySelector(".x-grid3-unlocked");
    const left = grid.querySelector(".x-grid3-locked");
    const leftRows = [...left.querySelectorAll(".x-grid3-body > .x-grid3-row")];
    const rightRows = [...right.querySelectorAll(".x-grid3-body > .x-grid3-row")];
    assert(leftRows.length && leftRows.length === rightRows.length, "Строки студентов ещё не загрузились.");
    const hidden = new Map(cells(rightRows[0]).filter((node) => node.style.display === "none")
      .map((node) => [key(node), clean(node.textContent)]));
    const headers = [...right.querySelectorAll(".x-grid3-header .x-grid3-gcell")]
      .filter((node) => headerPattern.test(clean(node.textContent)));
    const matching = headers.filter((node) => hidden.get(key(node)) === String(task.lessonId));
    assert(matching.length === 1, "Не найден уникальный ID выбранного занятия. Пересоберите журнал.");
    const header = matching[0], parsed = headerPattern.exec(clean(header.textContent));
    assert(String(Number(parsed[1])) === String(Number(task.number))
      && parsed[2].slice(0, 5) === String(task.date).slice(0, 5),
    "Дата или номер занятия изменились: повторно соберите журнал.");
    let studentRowIds = [];
    if (task.studentIds?.length) {
      const leftHidden = [...left.querySelectorAll(".x-grid3-header td.x-grid3-hd.x-grid3-cell")]
        .find((node) => node.style.display === "none");
      assert(leftHidden, "Не найдена колонка идентификаторов студентов.");
      const idKey = key(leftHidden);
      const ids = leftRows.map((row) => clean(cells(row).find((node) => key(node) === idKey)?.textContent));
      studentRowIds = ids;
      const expected = new Set(task.studentIds.map(String));
      assert(ids.length === expected.size && ids.every((id) => expected.has(id)),
        "Состав студентов изменился. Пересоберите журнал перед выставлением оценок.");
    }
    return {win, grid, right, left, rightRows, studentRowIds, header, headers, lessonKey: key(header)};
  }
  // В БАРС занятие выбирают нажатием на нижний заголовок «Пос»
  // (посещаемость), а НЕ на групповой заголовок «(№) - дата».
  // Опираемся на скрытый столбец ID занятия: одинаковые даты могут повторяться.
  function attendanceHeader(info) {
    const headers = [...info.right.querySelectorAll(".x-grid3-header td.x-grid3-hd.x-grid3-cell")];
    const start = headers.findIndex((node) => key(node) === info.lessonKey);
    assert(start >= 0, "Не найден скрытый заголовок ID выбранного занятия.");
    assert(!shown(headers[start]), "Изменилась структура скрытого ID занятия; выбор остановлен.");

    const current = info.headers.findIndex((node) => node === info.header);
    assert(current >= 0, "Заголовок выбранного занятия изменился.");
    const nextKey = info.headers[current + 1] && key(info.headers[current + 1]);
    const nextIndex = nextKey
      ? headers.findIndex((node, index) => index > start && key(node) === nextKey)
      : headers.length;
    assert(nextIndex > start, "Не определены границы столбцов выбранного занятия.");

    const candidates = headers.slice(start + 1, nextIndex)
      .filter((node) => shown(node) && /^пос\.?$/i.test(clean(node.textContent)));
    assert(candidates.length === 1,
      "Не найден единственный заголовок «Пос» под выбранной датой. Никаких изменений в БАРС не сделано.");
    return candidates[0];
  }

  function selectLesson(info) {
    const el = attendanceHeader(info);
    el.scrollIntoView({block: "center", inline: "center"});
    // События должны всплыть до обработчика заголовка Ext JS.
    // Нажатие на верхнюю строку даты не изменяет выбранное занятие.
    for (const type of ["mousedown", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, view: window}));
    }
    return el;
  }
  function button(win, id) {
    const wrapper = win.querySelector("#" + id);
    const el = wrapper?.querySelector("button");
    assert(el && shown(el), "Не найдена штатная кнопка " + id + ".");
    assert(!el.disabled && !wrapper.classList.contains("x-item-disabled"),
      "Команда недоступна в текущем состоянии занятия.");
    return el;
  }
  function ajaxTracker() {
    const ext = window.Ext;
    assert(ext?.Ajax?.on, "Ext JS ещё не готов.");
    const entries = [];
    const normalize = (options) => {
      const url = String(options?.url || "");
      try { return new URL(url, location.href).pathname; } catch { return url.split("?")[0]; }
    };
    const complete = (_connection, response, options) => {
      const path = normalize(options);
      let error = "";
      if (response?.status && !(response.status >= 200 && response.status < 300)) {
        error = "HTTP " + response.status;
      }
      const body = response?.responseText;
      if (typeof body === "string" && body.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(body);
          if (parsed.success === false || parsed.ok === false || parsed.error === true
            || typeof parsed.error === "string" && parsed.error) {
            error = "БАРС сообщил об ошибке сохранения.";
          }
        } catch { /* Ответ сайта может быть не JSON. */ }
      }
      entries.push({path, error});
    };
    const failure = (_connection, _response, options) => {
      entries.push({path: normalize(options), error: "Сетевой сбой."});
    };
    ext.Ajax.on("requestcomplete", complete);
    ext.Ajax.on("requestexception", failure);
    return {
      entries,
      async completed(suffix, after = 0, timeout = 16000) {
        const found = await until(() => entries.slice(after).find((item) => item.path.endsWith("/" + suffix)),
          timeout, "Не получено подтверждение операции «" + suffix + "» от БАРС.");
        assert(!found.error, "Операция «" + suffix + "»: " + found.error);
        return found;
      },
      detach() {
        ext.Ajax.un?.("requestcomplete", complete);
        ext.Ajax.un?.("requestexception", failure);
      }
    };
  }
  function dialogs(info) {
    return windows().filter((win) => win !== info.win
      && !/^Журнал (теоретических|практических) занятий/.test(windowTitle(win)));
  }
  function modalRows(info) {
    const matches = dialogs(info).filter((node) =>
      /ктп|привяз|тематическ/i.test(windowTitle(node)) || node.querySelector(".x-grid3-body > .x-grid3-row"));
    const win = matches[0];
    if (!win) return null;
    const grids = [...win.querySelectorAll(".x-grid3")].filter(shown);
    const rows = grids.flatMap((grid) => [...grid.querySelectorAll(".x-grid3-body > .x-grid3-row")].filter(shown));
    return rows.length ? {win, rows} : null;
  }
  function rowNumberMatch(row, desired) {
    const numbers = cells(row).filter(shown).map((node) => clean(node.textContent));
    return numbers.some((value) => value === desired || new RegExp("^\\(?" + desired + "\\)?[.):\\s–—-]").test(value));
  }
  function pickRow(row) {
    const cell = [...row.querySelectorAll("td.x-grid3-cell")].find(shown);
    assert(cell, "Не удалось выбрать строку КТП.");
    cell.scrollIntoView({block: "nearest"});
    cell.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true, view: window}));
    cell.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, view: window}));
  }
  function modalButton(win, labels) {
    const all = [...win.querySelectorAll("button")].filter(shown)
      .filter((node) => labels.some((label) => clean(node.textContent).toLowerCase() === label.toLowerCase()));
    return all.length === 1 && !all[0].disabled ? all[0] : null;
  }
  async function bindKtp(task, info, net) {
    const n = String(task.ktpNumber || "");
    assert(/^[1-9]\d{0,3}$/.test(n), "Для этой даты сначала укажите номер темы КТП в дашборде.");
    selectLesson(info);
    button(info.win, "bind_ctp_btn").click();
    let current = await until(() => modalRows(info), 14000,
      "Окно привязки КТП не открылось. Проверьте открытую вкладку БАРС.");
    // БАРС сначала предлагает КТП, затем загружает список его занятий.
    const matchingPlans = current.rows.filter((row) => clean(row.textContent).includes(clean(task.subject)));
    if (current.rows.length === 1 || matchingPlans.length === 1) {
      pickRow(current.rows.length === 1 ? current.rows[0] : matchingPlans[0]);
    } else {
      throw new Error("В окне несколько КТП без однозначного соответствия дисциплине. Выберите КТП вручную, затем повторите привязку.");
    }
    const originalRows = new Map(current.rows.map((row) => [row, clean(row.textContent)]));
    const targetRows = await until(() => {
      const now = modalRows(info);
      if (!now) return null;
      const found = now.rows.filter((row) => rowNumberMatch(row, n)
        && (!originalRows.has(row) || originalRows.get(row) !== clean(row.textContent)));
      if (found.length !== 1) return null;
      const activated = net.entries.some((item) => item.path.endsWith("/rowsactionforctpbinding"));
      return activated ? {win: now.win, row: found[0]} : null;
    }, 13000, "Не удалось определить ровно одну тему № " + n + ". Выберите её в окне БАРС вручную.");
    pickRow(targetRows.row);
    await sleep(200);
    const top = dialogs(info)[0] || targetRows.win;
    const commit = modalButton(top, ["Привязать", "Сохранить", "ОК", "Выбрать"]);
    if (!commit) throw new Error("Тема выделена. Подтвердите привязку штатной кнопкой окна БАРС.");
    const checkpoint = net.entries.length;
    commit.click();
    await net.completed("bind_ctp", checkpoint);
    await until(() => net.entries.slice(checkpoint).some(
      (item) => item.path.endsWith("/lessons_tab_rows")), 14000,
    "Привязка отправлена, но обновление журнала не подтверждено.");
    const afterBinding = scope(task);
    const bound = readBoundKtp(afterBinding);
    const verified = bound.status === "confirmed" && bound.topic === n;
    return {
      ok: bound.status !== "confirmed" || verified,
      verified, affected: 1, actualTopic: bound.topic,
      message: bound.status === "confirmed"
        ? (verified ? "Тема КТП № " + n + " подтверждена повторным чтением."
          : "Обнаружена другая тема КТП № " + bound.topic + ", ожидалась № " + n + ".")
        : "Запрос КТП № " + n + " выполнен, но в таблице нет однозначного номера темы для подтверждения. Не повторяйте привязку без сверки."
    };
  }
  function gridComponent(info) {
    const ext = window.Ext;
    let found;
    ext?.ComponentMgr?.all?.each?.((cmp) => {
      const el = cmp.getEl?.()?.dom;
      if (el?.contains?.(info.grid) && cmp.getColumnModel?.() && cmp.getStore?.() &&
        typeof cmp.startEditing === "function") {
        found = cmp;
        return false;
      }
    });
    return found;
  }
  function gradeColumn(info, cmp) {
    const cm = cmp.getColumnModel();
    const config = cm.config || [];
    const labels = [...info.right.querySelectorAll(".x-grid3-header .x-grid3-gcell")]
      .filter((node) => headerPattern.test(clean(node.textContent)));
    const lessonAt = labels.findIndex((node) => key(node) === info.lessonKey);
    const nextKey = labels[lessonAt + 1] && key(labels[lessonAt + 1]);
    const beginning = config.findIndex((item, i) => ("x-grid3-td-" + (cm.getColumnId?.(i) || item.id)) === info.lessonKey);
    const last = nextKey
      ? config.findIndex((item, i) => ("x-grid3-td-" + (cm.getColumnId?.(i) || item.id)) === nextKey)
      : config.length;
    assert(beginning >= 0 && last > beginning, "Не найдены столбцы выбранного занятия в Ext JS.");
    const candidates = [];
    for (let i = beginning; i < last; i++) {
      const col = config[i];
      const colId = cm.getColumnId?.(i) || col.id;
      const head = info.right.querySelector(".x-grid3-header td.x-grid3-hd.x-grid3-cell.x-grid3-td-" + colId);
      const description = [col.dataIndex, col.header, col.tooltip, head?.textContent,
        head?.querySelector("[ext\\:qtip]")?.getAttribute("ext:qtip")].map(clean).join(" ");
      if (/посещ|attendance|presence|absence|пропуск|^пос$/i.test(description)) continue;
      if (cm.isHidden?.(i) || col.hidden || !cm.isCellEditable?.(i, 0)) continue;
      const cell = info.rightRows[0].querySelector("td.x-grid3-td-" + colId);
      if (!shown(cell)) continue;
      candidates.push({i, named: /оцен|балл|mark|score|grade/i.test(description), cell, colId});
    }
    const named = candidates.filter((c) => c.named);
    if (named.length === 1) return named[0];
    if (named.length > 1) return null;
    if (candidates.length === 1) return candidates[0];
    // Пользователь может заранее выделить одну ячейку оценок в нужном столбце.
    const selected = candidates.filter((c) => c.cell.closest(".x-grid3")
      ?.querySelector(".x-grid3-cell-selected.x-grid3-td-" + c.colId));
    return selected.length === 1 ? selected[0] : null;
  }
  // Save response and Ext JS warning are observed in the SAME polling cycle.
  // Only an exact non-enrollment warning for this lesson/student may be dismissed.
  function visibleNotice(info) {
    const popups = dialogs(info).map((win) => {
      const el = win.querySelector(".ext-mb-text") ||
        win.querySelector(".ext-mb-content") ||
        win.querySelector(".x-window-body");
      return {win, text: clean(el?.textContent)};
    }).filter(({text}) => text);
    if (popups.length > 1) throw new Error(
      "БАРС открыл несколько диалогов. Автоматическое подтверждение запрещено.");
    return popups[0] || null;
  }

  function persistEnrollmentSkip(task, student, warning) {
    const requestId = "skip-" + crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, saved) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener("message", receive);
        error ? reject(error) : resolve(saved);
      };
      const receive = (event) => {
        const response = event.data;
        if (event.source !== window || event.origin !== location.origin ||
          response?.channel !== "bars-enrollment-skip-v1" ||
          response.kind !== "ack" || response.requestId !== requestId) return;
        finish(response.ok ? null : new Error(response.error ||
          "Не удалось сохранить пропуск студента в расширении."), response.skip);
      };
      const timer = setTimeout(() => finish(new Error(
        "Нет подтверждения сохранения пропуска студента. Продолжать запись нельзя.")), 10000);
      window.addEventListener("message", receive);
      window.postMessage({
        channel: "bars-enrollment-skip-v1", kind: "persist", requestId,
        task: {origin: task.origin, period: task.period, group: task.group,
          subject: task.subject, practical: task.practical, lessonId: task.lessonId,
          date: task.date},
        studentId: student.id, studentName: student.name, warning
      }, location.origin);
    });
  }

  async function waitForScoreOrNotice(task, info, net, checkpoint, student) {
    const model = window.__barsEnrollmentSkip;
    assert(model, "Модуль проверки зачисления не загружен.");
    // Polling checks BOTH independent signals; no pending promise races,
    // abandoned waiters or waiting for save_lesson_score after an alert.
    const evaluate = () => {
      const notice = visibleNotice(info);
      if (notice) return {kind: "notice", ...notice};
      const response = net.entries.slice(checkpoint)
        .find((entry) => entry.path.endsWith("/save_lesson_score"));
      return response ? {kind: "save", response} : null;
    };
    let observed = await until(evaluate, 12500,
      "БАРС не подтвердил сохранение и не показал предупреждение для студента " +
      student.name + ".");
    if (observed.kind === "save") {
      // Ext JS may show its message box slightly AFTER the XHR completes.
      await sleep(380);
      const later = visibleNotice(info);
      if (later) observed = {kind: "notice", ...later};
    }
    if (observed.kind === "notice") {
      assert(model.matchWarning(observed.text, task, student.name),
        "БАРС показал другое предупреждение: «" + observed.text +
        "». Оно оставлено открытым для ручной проверки.");
      const buttons = [...observed.win.querySelectorAll("button")].filter(shown)
        .filter((el) => !el.disabled);
      assert(buttons.length === 1 && /^(?:ОК|OK)$/i.test(clean(buttons[0].textContent)),
        "Предупреждение об отсутствии зачисления распознано, но нет единственной кнопки «ОК». Окно оставлено открытым.");
      const skipped = await persistEnrollmentSkip(task, student, observed.text);
      // Acknowledge only after the exception is durable, not before.
      buttons[0].click();
      await until(() => !shown(observed.win), 5000,
        "БАРС не закрыл подтверждённое предупреждение после «ОК».");
      return {kind: "skipped", skip: skipped};
    }
    assert(!observed.response.error,
      "Оценка студента " + student.name + " не сохранена: " +
      observed.response.error);
    return {kind: "saved"};
  }

  async function gradeAll(task, info, net) {
    selectLesson(info);
    const cmp = gridComponent(info);
    assert(cmp, "Не определён штатный редактор сетки Ext JS. Оценки не менялись.");
    const col = gradeColumn(info, cmp);
    assert(col, "Не определён однозначно столбец оценок. В БАРС выберите одну ячейку оценки нужного занятия и повторите.");
    const model = window.__barsEnrollmentSkip;
    assert(model, "Модуль проверки предупреждений о зачислении не загружен.");
    assert(info.studentRowIds?.length === info.rightRows.length,
      "Не удалось сопоставить строки с ID студентов.");
    const store = cmp.getStore();
    assert(store.getCount() === info.rightRows.length, "Сетка студентов изменилась. Оценки не менялись.");
    const students = new Map((task.students || []).map(({id, name}) => [String(id), {id: String(id), name}]));
    assert(students.size === info.rightRows.length,
      "Имена студентов не совпадают с таблицей. Пересоберите журнал.");
    task.enrollmentSkips ||= {};
    let changed = 0, alreadyThree = 0, other = 0, skippedNonEnrolled = 0;
    const skippedNames = [];
    const columnKey = "x-grid3-td-" + col.colId;
    for (let i = 0; i < store.getCount(); i++) {
      check();
      const id = String(info.studentRowIds[i]);
      const student = students.get(id);
      assert(student, "ID студента № " + (i + 1) + " не найден в журнале.");
      const active = info.rightRows[i]?.querySelector("td." + columnKey);
      assert(active && shown(active), "Изменилась таблица оценок, операция прервана после " + changed + " студентов.");
      const existing = clean(active.textContent);
      if (existing === "3") { alreadyThree++; continue; }
      if (existing && existing !== "—" && existing !== "-") { other++; continue; }
      if (model.validSkip(task.enrollmentSkips[id], task, id)) {
        skippedNonEnrolled++;
        skippedNames.push(student.name);
        continue;
      }
      assert(!visibleNotice(info),
        "Перед вводом оценки БАРС показывает другое окно. Необходимо закрыть его вручную.");
      assert(cmp.getColumnModel().isCellEditable?.(col.i, i),
        "Ячейка студента № " + (i + 1) + " недоступна.");
      const checkpoint = net.entries.length;
      cmp.startEditing(i, col.i);
      const editor = await until(() => cmp.activeEditor?.field?.setValue && cmp.activeEditor, 3000,
        "БАРС не открыл редактор оценки для студента № " + (i + 1) + ".");
      assert(editor.field.getValue?.() !== "3" || existing === "3" || !existing,
        "Обнаружен неожиданный редактор оценок.");
      editor.field.setValue("3");
      editor.completeEdit?.();
      if (cmp.activeEditor === editor) cmp.stopEditing?.();
      // Save response and warning are awaited concurrently via polling.
      const result = await waitForScoreOrNotice(task, info, net, checkpoint, student);
      if (result.kind === "skipped") {
        task.enrollmentSkips[id] = result.skip;
        skippedNonEnrolled++;
        skippedNames.push(student.name);
      } else {
        changed++;
      }
      await sleep(120);
    }
    const total = store.getCount();
    let verified = false, readback = "";
    if (changed + alreadyThree + other + skippedNonEnrolled === total) {
      try {
        const checkpoint = net.entries.length;
        button(info.win, "refresh_btn").click();
        await net.completed("lessons_tab_rows", checkpoint, 16000);
        const refreshed = scope(task);
        const reread = currentGrades(task, refreshed);
        verified = reread.status === "complete";
        const c = reread.counts;
        readback = " Повторная проверка: оценок — " +
          (c.scored || c.threes + c.nonThree || 0) + ", подтверждённых пропусков — " +
          (c.skippedNonEnrolled || 0) + ", неопределённых пустых ячеек — " + (c.empty || 0) + ".";
      } catch (error) {
        if (stopRequested) throw error;
        readback = " Повторная проверка не завершилась: " + error.message;
      }
    }
    return {
      ok: true, verified, affected: changed,
      skippedExisting: alreadyThree + other,
      skippedNonEnrolled,
      skipNames: skippedNames,
      message: "Занятие " + (model.fullDate(task.date, task.period) || task.date) +
        ": выставлено " + changed + " оценок, сохранено " +
        (alreadyThree + other) + " существующих, пропущено " + skippedNonEnrolled +
        " студентов — не числились в группе на дату занятия." +
        (skippedNames.length ? " Студенты: " + skippedNames.join("; ") + "." : "") +
        readback +
        (verified ? "" : " Итоговая проверка не подтверждена; требуется сверка.")
    };
  }

  // Достоверное чтение состояния конкретного занятия по его уникальному ID.
  // При отсутствии в БАРС явного поля номера КТП возвращаем unknown,
  // а не выводим успех по HTTP 200 или по локальным отметкам.
  function readBoundKtp(info) {
    const found = new Set();
    const exact = /^(?:data-)?(?:ctp|ktp)[-_]?(?:topic|theme)[-_]?(?:number|num|no)$/i;
    const nodes = [info.header, ...info.header.querySelectorAll("*")];
    for (const element of nodes) {
      for (const attr of [...(element.attributes || [])]) {
        if (exact.test(attr.name) && /^[1-9]\d{0,3}$/.test(attr.value)) found.add(String(Number(attr.value)));
      }
    }
    // Заголовок занятия иногда содержит явную подпись: "Тема КТП № N".
    // Не интерпретируем просто число занятия или дату как номер темы.
    const marker = /(?:тема\s+ктп|ктп\s*[:№]\s*тема)\s*№?\s*(\d{1,4})(?!\d)/ig;
    const label = clean(info.header.getAttribute("title")) + " " +
      clean(info.header.getAttribute("data-qtip")) + " " + clean(info.header.textContent);
    for (const match of label.matchAll(marker)) found.add(String(Number(match[1])));
    return found.size === 1 ? {status: "confirmed", topic: [...found][0]}
      : {status: "unknown", topic: null};
  }

  function evaluateGradeValues(values) {
    if (!Array.isArray(values) || !values.length || values.some((v) => v == null))
      return {status: "unknown", counts: {}};
    const blanks = values.filter((value) => value === "" || value === "—" || value === "-").length;
    const others = values.filter((value) => value !== "" && value !== "—" && value !== "-" &&
      value !== "3").length;
    const valid = values.filter((value) => /^[2-5]$/.test(value)).length;
    return {
      status: blanks === 0 && valid === values.length ? "complete" :
        blanks ? "incomplete" : "unknown",
      counts: {total: values.length, empty: blanks, nonThree: others,
        threes: values.filter((value) => value === "3").length},
      values
    };
  }

  function currentGrades(task, info) {
    const cmp = gridComponent(info);
    const column = cmp && gradeColumn(info, cmp);
    if (!column) return {status: "unknown", counts: {}};
    const cls = "x-grid3-td-" + column.colId;
    const values = info.rightRows.map((row) => {
      const cell = row.querySelector("td." + cls);
      return cell && shown(cell) ? clean(cell.textContent) : null;
    });
    const model = window.__barsEnrollmentSkip;
    return model && info.studentRowIds?.length === values.length
      ? model.evaluate(values, info.studentRowIds, task.enrollmentSkips || {}, task)
      : evaluateGradeValues(values);
  }

  async function inspectState(task, info, net, refresh = false) {
    if (refresh) {
      const checkpoint = net.entries.length;
      button(info.win, "refresh_btn").click();
      await net.completed("lessons_tab_rows", checkpoint, 16000);
    }
    let current = scope(task);
    selectLesson(current);
    await sleep(400);
    current = scope(task);
    const closeNode = current.win.querySelector("#close_lesson_btn");
    const reopenNode = current.win.querySelector("#open_lesson_btn");
    const isDisabled = (node) => Boolean(node && (
      node.classList.contains("x-item-disabled") || node.querySelector("button")?.disabled));
    let closure = "unknown";
    if (closeNode && reopenNode) {
      if (isDisabled(closeNode) && !isDisabled(reopenNode)) closure = "closed";
      if (!isDisabled(closeNode) && isDisabled(reopenNode)) closure = "open";
    }
    return {
      ok: true, verified: true,
      state: {ktp: readBoundKtp(current), grades: currentGrades(task, current), closure},
      message: "Прочитаны доступные признаки КТП, оценок и закрытия занятия № " +
        task.number + ". Нераспознаваемые признаки оставлены в состоянии «не определено»."
    };
  }

  // BARS обновляет доступность команд закрытия с задержкой на одно
  // закрытое занятие. Отправка и проверка поэтому разделены на две операции.
  async function verifyClosed(task, info, net, refresh = false) {
    if (refresh) {
      const checkpoint = net.entries.length;
      button(info.win, "refresh_btn").click();
      await net.completed("lessons_tab_rows", checkpoint, 16000);
    }
    let current = scope(task);
    selectLesson(current);
    await sleep(400);
    current = scope(task);
    const close = current.win.querySelector("#close_lesson_btn");
    const reopen = current.win.querySelector("#open_lesson_btn");
    assert(close && reopen, "Не найдены обе штатные кнопки состояния занятия.");
    const disabled = (node) => node.classList.contains("x-item-disabled")
      || Boolean(node.querySelector("button")?.disabled);
    const closed = disabled(close) && !disabled(reopen);
    return {
      ok: true, verified: closed,
      message: closed
        ? "Занятие № " + task.number + " (" + task.date +
          ") отображается как закрытое: открыть доступно, закрыть недоступно."
        : "Для занятия № " + task.number + " (" + task.date +
          ") БАРС пока не показывает подтверждённое закрытие." +
          (refresh ? " Повторное обновление не подтвердило статус." :
            " Проверьте его после следующего закрытия.")
    };
  }
  async function closeLesson(task, info, net, deferVerification = false) {
    selectLesson(info);
    const beforeDialogs = new Set(dialogs(info));
    const checkpoint = net.entries.length;
    button(info.win, "close_lesson_btn").click();
    await net.completed("lessons_tab_close_lesson_action", checkpoint);
    await net.completed("lessons_tab_rows", checkpoint);
    const modal = dialogs(info).find((win) => !beforeDialogs.has(win));
    if (modal) return {
      ok: false, verified: false,
      message: "БАРС открыл дополнительный диалог при закрытии. Подтвердите его вручную; пакет остановлен."
    };
    if (deferVerification) return {
      ok: true, verified: false, pending: true,
      message: "Запрос закрытия занятия № " + task.number +
        " выполнен. Статус будет проверен после закрытия следующего занятия."
    };
    return verifyClosed(task, scope(task), net, false);
  }
  async function run(task) {
    if (running) return {ok: false, message: "Уже выполняется операция в этом журнале."};
    running = true;
    stopRequested = false;
    let net;
    try {
      const info = scope(task);
      if (task.action === "check") return {ok: true, verified: true,
        message: "Сверены группа, предмет, тип журнала, дата, ID занятия и " + info.rightRows.length + " строк студентов."};
      net = ajaxTracker();
      if (task.action === "inspect" || task.action === "inspectRefresh")
        return inspectState(task, info, net, task.action === "inspectRefresh");
      const result = task.action === "bind" ? await bindKtp(task, info, net)
        : task.action === "grades" ? await gradeAll(task, info, net)
          : task.action === "close" ? await closeLesson(task, info, net)
            : task.action === "closeBatch" ? await closeLesson(task, info, net, true)
              : task.action === "verifyClose" ? await verifyClosed(task, info, net, false)
                : task.action === "verifyCloseFinal" ? await verifyClosed(task, info, net, true)
                  : (() => {throw new Error("Неизвестное действие.");})();
      return result;
    } catch (error) {
      return {ok: false, verified: false, message: error.message};
    } finally {
      net?.detach();
      running = false;
    }
  }
  window.__barsLessonActions = {version: 5, run, evaluateGradeValues, waitForScoreOrNotice, stop() {stopRequested = true;}};
})();
