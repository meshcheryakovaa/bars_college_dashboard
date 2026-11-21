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

  function labeledField(window, label) {
    if (!window) return null;
    const fields = all(window, ".x-form-item")
      .filter((item) => visible(item) && label.test(text(item.querySelector("label"))))
      .map((item) => item.querySelector('input[type="text"]'))
      .filter((field) => field?.id && visible(field) && !field.disabled);
    return fields.length === 1 ? fields[0] : null;
  }

  const groupField = (window) => labeledField(window, /^(учебная\s+)?группа\s*[:*]?$/i);
  const dateFields = (window) => [labeledField(window, /^с\s*:?$/i), labeledField(window, /^по\s*:?$/i)];
  let recentGroupList;

  function findScope() {
    const journals = all(document, ".x-window").filter((window) =>
      visible(window) && /^Журнал (теоретических|практических) занятий/.test(
        text(window.querySelector(".x-window-header-text"))
      )
    ).sort((a, b) => Number(b.style.zIndex || 0) - Number(a.style.zIndex || 0));
    const [window] = journals;
    if (!window || journals.length > 1 && window.style.zIndex === journals[1].style.zIndex) return null;
    const practical = /^Журнал практических занятий/.test(text(window.querySelector(".x-window-header-text")));
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
    const lists = groupLists();
    const recent = recentGroupList && lists.find(({list}) => list.id === recentGroupList);
    const groupLabels = (recent ? [recent] : lists)
      .filter(({list}) => !visible(list)).flatMap(({list}) => all(list, ".x-combo-selected").map(text));
    const fallback = groupLabels.length ? groupLabels : all(document, ".x-combo-list-inner .x-combo-selected")
      .map(text).filter((label) => courseSuffix.test(label));
    const fieldValue = clean(groupField(window)?.value);
    const group = courseSuffix.test(fieldValue) || groupCode.test(fieldValue)
      ? fieldValue : fallback.length === 1 ? fallback[0] : "";
    const period = readPeriod();
    return {window, grid, field: fields.length === 1 ? fields[0] : null, group, period, practical};
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

    return {origin: location.origin, period, group, subject, students, lessons, ...(scope.practical ? {kind: "practical"} : {})};
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
  let manualStarted;
  let autoStarted;
  let catalogController;

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
      await save(journal, manualStarted);
      lastSent = fingerprint;
    } catch (error) {
      if (!chrome.runtime.id) clearInterval(timer);
      else console.warn("Сборщик журналов", error.message);
    } finally {
      sending = false;
    }
  }

  async function save(journal, startedAt) {
    const result = await chrome.runtime.sendMessage({type: "saveJournal", journal, startedAt});
    if (!result?.ok) throw new Error(result?.error || "Не удалось сохранить журнал.");
  }

  async function saveCatalog(period, groups, startedAt) {
    const result = await chrome.runtime.sendMessage({
      type: "saveCatalog", startedAt, catalog: {origin: location.origin, period, groups}
    });
    if (!result?.ok) throw new Error(result?.error || "Не удалось сохранить справочник.");
  }

  async function collectGroups(signal, startedAt) {
    if (!document.querySelector("#x-desktop")) {
      throw new Error("Откройте «Электронный колледж».");
    }
    const groups = await waitStable(() => {
      const lists = groupLists();
      const expanded = lists.filter(({list}) => visible(list));
      const [match] = expanded.length === 1 ? expanded : lists.length === 1 ? lists : [];
      if (!match) return null;
      const names = [...new Set(match.names)];
      return {key: JSON.stringify(names), value: names};
    }, signal, "Список групп не найден. Раскройте список групп на сайте и повторите сбор.");
    signal.throwIfAborted();
    await saveCatalog(readPeriod(), groups.map((name) => ({name})), startedAt);
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
        detail: JSON.stringify({id, action, fieldId: scope?.field.id, option})
      }));
    } finally {
      document.removeEventListener("college-journal-page-response", receive);
    }
    if (!reply || reply.error) throw new Error(reply?.error || "Связь с журналом потеряна.");
    return reply.result;
  }

  async function waitStable(probe, signal, failure, tolerance = 650, timeout = 60000) {
    const deadline = Date.now() + timeout;
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

  const groupName = (value) => clean(value).replace(courseSuffix, "").replace(/[–—]/g, "-");
  async function applyDates(range, signal) {
    if (!range) return;
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!iso.test(range.from) || !iso.test(range.to) || range.from > range.to) {
      throw new Error("Дата начала должна быть не позднее даты окончания.");
    }
    const dates = [range.from, range.to];
    const before = await waitStable(() => {
      const scope = findScope();
      const fields = dateFields(scope?.window);
      if (fields.some((field) => !field) || masked() || pageCommand(null, "ajax").busy) return null;
      const fieldIds = fields.map((field) => field.id);
      const period = pageCommand(null, "dateState", {fieldIds}).dates;
      return {key: JSON.stringify([fieldIds, period]), value: {fieldIds, period}};
    }, signal, "Откройте журнал и дождитесь появления полей «С» и «По».");
    if (before.period.every((value, i) => value === dates[i])) return;

    pageCommand(null, "setDates", {fieldIds: before.fieldIds, dates});
    await waitStable(() => {
      const fields = dateFields(findScope()?.window);
      if (fields.some((field) => !field) || masked() || pageCommand(null, "ajax").busy) return null;
      const fieldIds = fields.map((field) => field.id);
      const actual = pageCommand(null, "dateState", {fieldIds}).dates;
      return actual.every((value, i) => value === dates[i]) ? {key: fieldIds.join(" "), value: true} : null;
    }, signal, "Журнал не подтвердил диапазон дат.");
  }

  async function openBatchGroup(target, signal, practical) {
    const previous = findScope();
    const version = previous && tableVersion(previous);
    let opening;
    let selected = false;
    const manualAt = Date.now() + 10000;
    auto.message = "Открываем журнал группы…";

    return waitStable(() => {
      const period = readPeriod();
      if (period !== target.period) throw new Error("Учебный период на сайте изменился.");
      const active = findScope();
      if (active && active.practical !== practical) throw new Error("Тип журнала изменился.");
      const ajax = pageCommand(null, "ajax");
      if (masked() || ajax.busy) return null;

      const isTarget = active?.field && groupName(active.group) === groupName(target.name);
      const currentVersion = active && tableVersion(active);
      const fresh = !previous || active?.window !== previous.window || currentVersion?.grid !== version.grid
        || currentVersion?.row !== version.row || groupName(previous.group) === groupName(target.name);
      if (isTarget && fresh && !pageCommand(active, "state").busy) {
        return {key: active.field.id, value: active};
      }

      const field = groupField(active?.window);
      if (field && !selected && !isTarget) {
        const picker = {field};
        try {
          if (opening !== field) {
            opening = field;
            pageCommand(picker, "open");
          }
          const list = pageCommand(picker, "list");
          if (list.expanded && !list.busy && list.total <= list.items.length
            && (list.rendered === null || list.rendered === list.items.length)) {
            const matches = list.items.filter(({label}) => groupName(label) === groupName(target.name));
            if (matches.length === 1) {
              pageCommand(picker, "select", {...matches[0], activateItem: true});
              selected = true;
              recentGroupList = list.listId;
            }
          }
        } catch {
          // If this deployment uses a different group picker, wait for the user's selection.
        }
      }

      if (Date.now() >= manualAt) auto.message = "Если окно не открылось, выберите эту группу на сайте.";
      return null;
    }, signal, "Не удалось открыть журнал группы «" + target.name + "».", 650, 120000);
  }

  async function collectMarked(groups, signal, range) {
    const period = readPeriod();
    const available = groups.filter((group) => group.origin === location.origin && group.period === period);
    if (!available.length) throw new Error("Нет отмеченных групп для текущего сайта и учебного периода.");
    recentGroupList = undefined;
    const initial = findScope();
    if (!initial) throw new Error("Откройте нужный журнал колледжа.");
    const {practical} = initial;
    const current = groupName(initial.group);
    const queue = [...available.filter(({name}) => groupName(name) === current),
      ...available.filter(({name}) => groupName(name) !== current)];
    auto.batch = {done: 0, total: queue.length, group: ""};
    for (const group of queue) {
      signal.throwIfAborted();
      auto.batch.group = group.name;
      auto.saved = 0;
      auto.total = 0;
      await applyDates(range, signal);
      await openBatchGroup(group, signal, practical);
      await applyDates(range, signal);
      await collectGroup(signal, group);
      auto.batch.done++;
    }
    auto.batch.group = "";
    auto.saved = 0;
    auto.total = 0;
    auto.message = "Сбор отмеченных групп завершён.";
  }

  async function collectGroup(signal, target) {
    const start = findScope();
    if (!start?.field) throw new Error("Откройте вкладку «Журнал» нужной группы.");
    if (target && groupName(start.group) !== groupName(target.name)) {
      throw new Error("Открылась другая группа. Сбор остановлен.");
    }
    function groupScope() {
      const current = findScope();
      if (!start.window.isConnected || (current && (current.window !== start.window
        || current.period !== start.period || (start.group && current.group && groupName(current.group) !== groupName(start.group))))) {
        throw new Error("Группа или учебный период сменились.");
      }
      if (target && groupName(current?.group) !== groupName(target.name)) return null;
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
      }], autoStarted);
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
      await save(target ? {...journal, group: target.name} : journal, autoStarted);
      auto.saved++;
    }
    auto.message = "Автосбор завершён.";
  }

  function handleMessage(message, sender, reply) {
    if (message.type !== "collectorStatus") return;
    if (message.manual !== undefined && !auto.running) {
      manual = message.manual;
      manualStarted = Date.now();
      lastSent = undefined;
      candidate = undefined;
    }
    if (message.stopAuto) controller?.abort();
    if (message.catalog && !auto.running && !readingGroups) {
      readingGroups = true;
      catalogMessage = "Ожидание списка групп…";
      catalogController = new AbortController();
      collectGroups(catalogController.signal, Date.now()).then((result) => { catalogMessage = result; })
        .catch((error) => { catalogMessage = catalogController.signal.aborted ? "Сбор списка групп остановлен." : error.message; })
        .finally(() => { readingGroups = false; catalogController = undefined; });
    }
    if ((message.startAuto || message.markedGroups?.length || message.applyDates) && !auto.running && !readingGroups) {
      manual = false;
      controller = new AbortController();
      autoStarted = Date.now();
      auto = {running: true, saved: 0, total: 0, message: message.range ? "Применяем даты…" : "Ожидание списка предметов…"};
      const {signal} = controller;
      async function run() {
        if (message.markedGroups?.length) {
          await collectMarked(message.markedGroups, signal, message.range);
          return;
        }
        await applyDates(message.range, signal);
        if (message.applyDates) auto.message = "Диапазон дат применён. Можно выбирать группу.";
        else await collectGroup(signal);
      }
      run().catch((error) => {
        auto.message = signal.aborted ? "Автосбор остановлен." : error.message;
      }).finally(() => {
        auto.running = false;
        recentGroupList = undefined;
        controller = undefined;
      });
    }
    reply({running: manual, auto, readingGroups, catalogMessage});
  }

  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes["dashboard:cleared-at"]) return;
    manual = false;
    candidate = lastSent = undefined;
    controller?.abort();
    catalogController?.abort();
  });
  globalThis.collegeJournalCollector = true;
  chrome.runtime.onMessage.addListener(handleMessage);
  timer = setInterval(scan, 350);
})();
