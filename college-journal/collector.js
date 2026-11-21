(() => {
  if (globalThis.collegeJournalCollector) return;

  const all = (root, selector) => [...root.querySelectorAll(selector)];
  const clean = (value) => (value ?? "").replace(/\s+/g, " ").trim();
  const text = (element) => clean(element?.textContent);
  const columnKey = (element) =>
    [...element.classList].find((name) => name.startsWith("x-grid3-td-"));
  const rows = (panel) => all(panel, ".x-grid3-body > .x-grid3-row");
  const cells = (row) => all(row, "td.x-grid3-cell");
  const dateHeader = /^\((\d+)\)\s*[-–—]\s*(\d{1,2}\.\d{2}(?:\.\d{2,4})?)(?![\d.])/;
  const visible = (element) => Boolean(element.getClientRects().length)
    && getComputedStyle(element).visibility === "visible";

  const readPeriod = () => text(all(document, "#x-desktop .widget .title")
      .find((element) => text(element) === "Период обучения")?.nextElementSibling);

  const courseSuffix = /\s[-–—]\s\d+\s+курс$/i;
  const groupCode = /^[\p{L}\p{N}]+(?:[-–—][\p{L}\p{N}]+){2,}$/u;

  function groupLists() {
    return all(document, ".x-combo-list-inner").map((list) => ({
      list, names: all(list, ".x-combo-list-item").map(text).filter(Boolean)
    })).filter(({names}) => names.some((name) => courseSuffix.test(name))
      && names.every((name) => courseSuffix.test(name) || groupCode.test(name)));
  }

  function findScope() {
    const journals = all(document, ".x-window").filter((window) =>
      visible(window) && /^Журнал теоретических занятий/.test(
        text(window.querySelector(".x-window-header-text"))
      )
    );
    if (journals.length !== 1) return null;
    const [window] = journals;
    if (!all(window, ".x-tab-strip-active .x-tab-strip-text").some((tab) => text(tab) === "Журнал")) {
      return null;
    }

    const grids = all(window, ".x-grid3").filter((grid) =>
      visible(grid) && grid.querySelector(".x-grid3-locked") && grid.querySelector(".x-grid3-unlocked")
    );
    const grid = grids.length === 1 ? grids[0] : null;
    const panel = grid?.closest(".x-window-mc");
    const fields = all(panel ?? window, ".x-form-item").filter((item) =>
      /^Предмет\s*:?$/.test(text(item.querySelector("label"))) && visible(item)
    ).map((item) => item.querySelector('input[type="text"]')).filter(Boolean);
    const groupLabels = groupLists().flatMap(({list}) => all(list, ".x-combo-selected").map(text));
    const fallback = groupLabels.length ? groupLabels : all(document, ".x-combo-list-inner .x-combo-selected")
      .map(text).filter((label) => courseSuffix.test(label));
    const group = fallback.length === 1 ? fallback[0] : "";
    const period = readPeriod();
    return {window, grid, field: fields.length === 1 ? fields[0] : null, group, period};
  }

  const masked = () => all(document, ".ext-el-mask, .ext-el-mask-msg").some(visible);

  function readPage(scope = findScope()) {
    if (!scope?.grid || !scope.field || masked()) return null;
    const {grid, field, period, group} = scope;
    const subject = clean(field.value);
    if (!subject || field.classList.contains("x-form-empty-field")) return null;

    const left = grid.querySelector(".x-grid3-locked");
    const right = grid.querySelector(".x-grid3-unlocked");
    const leftRows = rows(left);
    const rightRows = rows(right);
    if (!leftRows.length || leftRows.length !== rightRows.length) return null;

    const leftHeaders = all(left, ".x-grid3-header td.x-grid3-hd.x-grid3-cell");
    const numberKey = columnKey(leftHeaders.find((item) => text(item) === "№") ?? left);
    const nameKey = columnKey(leftHeaders.find((item) => /^Ф\.?\s*И\.?\s*О\.?$/i.test(text(item))) ?? left);
    const idKey = columnKey(leftHeaders.find((item) => item.style.display === "none") ?? left);
    if (!numberKey || !nameKey || !idKey) return null;

    const students = leftRows.map((row) => {
      const byKey = new Map(cells(row).map((item) => [columnKey(item), text(item)]));
      return {id: byKey.get(idKey), number: byKey.get(numberKey), name: byKey.get(nameKey)};
    });
    if (students.some(({id, number, name}) => !/^\d+$/.test(id ?? "") || !number || !name)
      || new Set(students.map(({id}) => id)).size !== students.length) {
      return null;
    }

    const lessons = [];
    const valuesByColumn = new Map();
    for (const item of cells(rightRows[0])) {
      if (item.style.display === "none") valuesByColumn.set(columnKey(item), text(item));
    }
    for (const header of all(right, ".x-grid3-header .x-grid3-gcell")) {
      const label = text(header);
      const date = dateHeader.exec(label);
      if (!date) continue;
      const id = valuesByColumn.get(columnKey(header));
      if (!/^\d+$/.test(id ?? "")) return null;
      lessons.push({id, number: date[1], date: date[2], label});
    }
    if (new Set(lessons.map(({id}) => id)).size !== lessons.length) return null;

    return {origin: location.origin, period, group, subject, students, lessons};
  }

  let timer;
  let lastSent;
  let manual = false;
  let auto = {running: false, saved: 0, total: 0, message: ""};
  let controller;
  let commandId = 0;
  let candidate;
  let stableSince = 0;
  let sending = false;
  let readingGroups = false;
  let catalogMessage = "";

  async function scan() {
    if (!manual || sending || auto.running) return;

    const journal = readPage();
    if (!journal) {
      candidate = undefined;
      return;
    }

    const fingerprint = JSON.stringify(journal);
    if (fingerprint !== candidate) {
      candidate = fingerprint;
      stableSince = Date.now();
      return;
    }
    if (fingerprint === lastSent || Date.now() - stableSince < 900) return;

    sending = true;
    try {
      await save(journal);
      lastSent = fingerprint;
    } catch (error) {
      if (!chrome.runtime.id) clearInterval(timer);
      else console.warn("Сборщик журналов", error.message);
    } finally {
      sending = false;
    }
  }

  async function save(journal) {
    const result = await chrome.runtime.sendMessage({type: "saveJournal", journal});
    if (!result?.ok) throw new Error(result?.error || "Не удалось сохранить журнал.");
  }

  async function saveCatalog(period, groups) {
    const result = await chrome.runtime.sendMessage({
      type: "saveCatalog", catalog: {origin: location.origin, period, groups}
    });
    if (!result?.ok) throw new Error(result?.error || "Не удалось сохранить справочник.");
  }

  async function collectGroups() {
    if (!document.querySelector("#x-desktop")) {
      throw new Error("Откройте «Электронный колледж».");
    }
    const signal = new AbortController().signal;
    const groups = await waitStable(() => {
      const lists = groupLists();
      const expanded = lists.filter(({list}) => visible(list));
      const [match] = expanded.length === 1 ? expanded : lists.length === 1 ? lists : [];
      if (!match) return null;
      const names = [...new Set(match.names)];
      return {key: JSON.stringify(names), value: names};
    }, signal, "Список групп не найден. Раскройте список групп на сайте и повторите сбор.");
    await saveCatalog(readPeriod(), groups.map((name) => ({name})));
    return `В справочник добавлено групп — ${groups.length}.`;
  }

  function pageCommand(scope, action, option) {
    const id = ++commandId;
    let reply;
    const receive = (event) => {
      const message = JSON.parse(event.detail);
      if (message.id === id) reply = message;
    };
    document.addEventListener("college-journal-page-response", receive);
    try {
      document.dispatchEvent(new CustomEvent("college-journal-page-request", {
        detail: JSON.stringify({id, action, fieldId: scope.field.id, option})
      }));
    } finally {
      document.removeEventListener("college-journal-page-response", receive);
    }
    if (!reply || reply.error) throw new Error(reply?.error || "Связь с журналом потеряна.");
    return reply.result;
  }

  async function waitStable(probe, signal, failure, tolerance = 650) {
    const deadline = Date.now() + 60000;
    let previous;
    let since;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const result = probe();
      if (!result || result.key !== previous) {
        previous = result?.key;
        since = Date.now();
      } else if (Date.now() - since >= tolerance) {
        return result.value;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    signal.throwIfAborted();
    throw new Error(failure);
  }

  function tableVersion(scope) {
    const right = scope.grid?.querySelector(".x-grid3-unlocked");
    return {
      grid: scope.grid,
      row: right ? rows(right)[0] : undefined
    };
  }

  async function collectGroup(signal) {
    const start = findScope();
    if (!start?.field) throw new Error("Откройте вкладку «Журнал» нужной группы.");
    function groupScope() {
      const current = findScope();
      if (!start.window.isConnected || (current && (current.window !== start.window
        || current.period !== start.period || (start.group && current.group && current.group !== start.group)))) {
        throw new Error("Группа или учебный период сменились.");
      }
      return current?.field ? current : null;
    }

    const initial = await waitStable(() => {
      const scope = groupScope();
      return scope && !masked() && !pageCommand(scope, "state").busy
        ? {key: scope.field.id, value: scope} : null;
    }, signal, "Журнал группы не загрузился.");

    pageCommand(initial, "open");
    const options = await waitStable(() => {
      const scope = groupScope();
      if (!scope || masked()) return null;
      const list = pageCommand(scope, "list");
      if (list.busy || !list.expanded || !list.items.length
        || (list.rendered !== null && list.rendered !== list.items.length)) return null;
      if (list.total > list.items.length) throw new Error("Список разбит на страницы. Автосбор остановлен.");
      const keys = new Set(list.items.map(({value}) => value));
      if (keys.size !== list.items.length || list.items.some(({label, value}) => !label || !value)) {
        throw new Error("В списке есть предметы без однозначного значения.");
      }
      return {key: JSON.stringify(list.items), value: list.items};
    }, signal, "Список предметов не загрузился за 60 секунд.");
    const scope = groupScope();
    if (!scope) throw new Error("Окно журнала стало недоступно.");
    pageCommand(scope, "close");
    auto.total = options.length;
    if (scope.group) {
      await saveCatalog(scope.period, [{
        name: scope.group, disciplines: options.map(({label, value}) => ({id: value, name: label}))
      }]);
    }

    const selected = pageCommand(scope, "state").value;
    const ordered = [...options.filter(({value}) => value === selected),
      ...options.filter(({value}) => value !== selected)];
    for (const option of ordered) {
      signal.throwIfAborted();
      const current = groupScope();
      if (!current) throw new Error("Окно журнала стало недоступно.");
      auto.message = "Загрузка: " + option.label;
      const previous = tableVersion(current);
      const alreadyOpen = pageCommand(current, "state").value === option.value
        && clean(current.field.value) === option.label;
      if (!alreadyOpen) pageCommand(current, "select", option);

      const journal = await waitStable(() => {
        const active = groupScope();
        if (!active || masked()) return null;
        const state = pageCommand(active, "state");
        const latest = tableVersion(active);
        if (state.busy || state.value !== option.value || clean(active.field.value) !== option.label
          || (!alreadyOpen && latest.grid === previous.grid && latest.row === previous.row)) return null;
        const data = readPage(active);
        return data ? {key: JSON.stringify(data), value: data} : null;
      }, signal, "Не дождались новой таблицы для предмета «" + option.label + "» за 60 секунд.");
      signal.throwIfAborted();
      await save(journal);
      auto.saved++;
    }
    auto.message = "Автосбор завершён.";
  }

  function handleMessage(message, sender, reply) {
    if (message.type !== "collectorStatus") return;
    if (message.manual !== undefined && !auto.running) {
      manual = message.manual;
      candidate = undefined;
    }
    if (message.stopAuto) controller?.abort();
    if (message.catalog && !auto.running && !readingGroups) {
      readingGroups = true;
      catalogMessage = "Ожидание списка групп…";
      collectGroups().then((result) => { catalogMessage = result; })
        .catch((error) => { catalogMessage = error.message; })
        .finally(() => { readingGroups = false; });
    }
    if (message.startAuto && !auto.running && !readingGroups) {
      manual = false;
      controller = new AbortController();
      auto = {running: true, saved: 0, total: 0, message: "Ожидание списка предметов…"};
      const {signal} = controller;
      collectGroup(signal).catch((error) => {
        auto.message = signal.aborted ? "Автосбор остановлен." : error.message;
      }).finally(() => {
        auto.running = false;
        controller = undefined;
      });
    }
    reply({running: manual, auto, readingGroups, catalogMessage});
  }

  globalThis.collegeJournalCollector = true;
  chrome.runtime.onMessage.addListener(handleMessage);
  timer = setInterval(scan, 350);
})();
