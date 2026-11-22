/* Запись через штатные Ext JS обработчики БАРС, без прямых запросов к API. */
(() => {
  "use strict";
  if (window.__barsLessonActions?.version === 1) return;
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
    if (task.studentIds?.length) {
      const leftHidden = [...left.querySelectorAll(".x-grid3-header td.x-grid3-hd.x-grid3-cell")]
        .find((node) => node.style.display === "none");
      assert(leftHidden, "Не найдена колонка идентификаторов студентов.");
      const idKey = key(leftHidden);
      const ids = leftRows.map((row) => clean(cells(row).find((node) => key(node) === idKey)?.textContent));
      const expected = new Set(task.studentIds.map(String));
      assert(ids.length === expected.size && ids.every((id) => expected.has(id)),
        "Состав студентов изменился. Пересоберите журнал перед выставлением оценок.");
    }
    return {win, grid, right, left, rightRows, header, headers, lessonKey: key(header)};
  }
  function selectLesson(info) {
    info.header.scrollIntoView({block: "center", inline: "center"});
    const el = info.header;
    el.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true, view: window}));
    el.dispatchEvent(new MouseEvent("mouseup", {bubbles: true, cancelable: true, view: window}));
    el.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, view: window}));
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
    return {ok: true, verified: false, affected: 1,
      message: "Запрос привязки темы № " + n + " завершён и строки журнала обновлены. Проверьте тему в БАРС и отметьте привязку."};
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
  async function gradeAll(task, info, net) {
    selectLesson(info);
    const cmp = gridComponent(info);
    assert(cmp, "Не определён штатный редактор сетки Ext JS. Оценки не менялись.");
    const col = gradeColumn(info, cmp);
    assert(col, "Не определён однозначно столбец оценок. В БАРС выберите одну ячейку оценки нужного занятия и повторите.");
    const store = cmp.getStore();
    assert(store.getCount() === info.rightRows.length, "Сетка студентов изменилась. Оценки не менялись.");
    let changed = 0, alreadyThree = 0, other = 0;
    const columnKey = "x-grid3-td-" + col.colId;
    for (let i = 0; i < store.getCount(); i++) {
      check();
      const active = info.rightRows[i]?.querySelector("td." + columnKey);
      assert(active && shown(active), "Изменилась таблица оценок, операция прервана после " + changed + " студентов.");
      const existing = clean(active.textContent);
      if (existing === "3") { alreadyThree++; continue; }
      if (existing && existing !== "—" && existing !== "-") { other++; continue; }
      assert(cmp.getColumnModel().isCellEditable?.(col.i, i), "Ячейка студента № " + (i + 1) + " недоступна.");
      const checkpoint = net.entries.length;
      cmp.startEditing(i, col.i);
      const editor = await until(() => cmp.activeEditor?.field?.setValue && cmp.activeEditor, 3000,
        "БАРС не открыл редактор оценки для студента № " + (i + 1) + ".");
      assert(editor.field.getValue?.() !== "3" || existing === "3" || !existing,
        "Обнаружен неожиданный редактор оценок.");
      editor.field.setValue("3");
      editor.completeEdit?.();
      if (cmp.activeEditor === editor) cmp.stopEditing?.();
      await net.completed("save_lesson_score", checkpoint, 12000);
      changed++;
      await sleep(120);
    }
    const total = store.getCount();
    let verified = false;
    let readback = "";
    if (other === 0 && changed + alreadyThree === total) {
      try {
        const checkpoint = net.entries.length;
        button(info.win, "refresh_btn").click();
        await net.completed("lessons_tab_rows", checkpoint, 16000);
        const refreshed = scope(task);
        const refreshedGrid = gridComponent(refreshed);
        const refreshedCol = refreshedGrid && gradeColumn(refreshed, refreshedGrid);
        assert(refreshedCol, "После обновления не удалось определить оценочную колонку.");
        const className = "x-grid3-td-" + refreshedCol.colId;
        const saved = refreshed.rightRows.filter((row) =>
          clean(row.querySelector("td." + className)?.textContent) === "3").length;
        verified = saved === total;
        readback = " После повторной загрузки подтверждено оценок «3»: " + saved + " из " + total + ".";
      } catch (error) {
        if (stopRequested) throw error;
        readback = " Повторная проверка не завершилась: " + error.message;
      }
    }
    return {
      ok: true, verified,
      affected: changed,
      skippedExisting: other,
      message: "Сохранение оценок: новые «3» — " + changed + ", уже «3» — " + alreadyThree +
        ", другие существующие значения сохранены без изменения — " + other + "." + readback
        + (verified ? "" : " Проверьте оценки в БАРС перед подтверждением.")
    };
  }
  async function closeLesson(task, info, net) {
    selectLesson(info);
    const beforeDialogs = new Set(dialogs(info));
    const checkpoint = net.entries.length;
    button(info.win, "close_lesson_btn").click();
    await net.completed("lessons_tab_close_lesson_action", checkpoint);
    await until(() => net.entries.slice(checkpoint).some((item) => item.path.endsWith("/lessons_tab_rows")),
      15000, "Запрос закрытия выполнен, но обновление таблицы не подтверждено.");
    const modal = dialogs(info).find((win) => !beforeDialogs.has(win));
    if (modal) return {ok: true, verified: false,
      message: "Запрос закрытия выполнен. Проверьте дополнительное окно БАРС и подтвердите закрытие вручную."};
    const refreshed = scope(task);
    selectLesson(refreshed);
    await sleep(250);
    const close = refreshed.win.querySelector("#close_lesson_btn");
    const reopen = refreshed.win.querySelector("#open_lesson_btn");
    const disabled = (node) => !node || node.classList.contains("x-item-disabled")
      || Boolean(node.querySelector("button")?.disabled);
    if (disabled(close) && !disabled(reopen)) return {ok: true, verified: true,
      message: "Занятие закрыто: после обновления «Закрыть занятие» отключено, а «Открыть занятие» доступно."};
    return {ok: true, verified: false,
      message: "Запрос закрытия и обновление журнала завершены, но статус не определён. Проверьте закрытие в БАРС."};
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
      const result = task.action === "bind" ? await bindKtp(task, info, net)
        : task.action === "grades" ? await gradeAll(task, info, net)
          : task.action === "close" ? await closeLesson(task, info, net)
            : (() => {throw new Error("Неизвестное действие.");})();
      return result;
    } catch (error) {
      return {ok: false, verified: false, message: error.message};
    } finally {
      net?.detach();
      running = false;
    }
  }
  window.__barsLessonActions = {version: 1, run, stop() {stopRequested = true;}};
})();
