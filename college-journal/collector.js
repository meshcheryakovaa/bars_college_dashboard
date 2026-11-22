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
    const fields = new Set();
    for (const caption of all(window, "label")) {
      if (!label.test(text(caption))) continue;
      const field = caption.control ?? caption.closest(".x-form-item")?.querySelector('input[type="text"]');
      if (field?.matches("input") && field.id && window.contains(field) && visible(field) && !field.disabled) fields.add(field);
    }
    return fields.size === 1 ? fields.values().next().value : null;
  }

  const groupField = (window) => labeledField(window, /^(учебная\s+)?группа\s*[:*]?$/i);
  const dateFields = (window) => [labeledField(window, /^с\s*:?$/i), labeledField(window, /^по\s*:?$/i)];
  let recentGroupList;

  const journalTitle = (practical) => practical ? "Журнал практических занятий" : "Журнал теоретических занятий";
  const windowTitle = (window) => text(window.querySelector(".x-window-header-text"));

  function journalWindows(practical) {
    return all(document, ".x-window").filter((window) => visible(window) && (practical === undefined
      ? /^Журнал (теоретических|практических) занятий/.test(windowTitle(window))
      : windowTitle(window).startsWith(journalTitle(practical)))
    ).sort((a, b) => Number(b.style.zIndex || 0) - Number(a.style.zIndex || 0));
  }

  function findScope(kind) {
    const [window] = journalWindows(kind);
    if (!window) return null;
    const practical = windowTitle(window).startsWith(journalTitle(true));
    if (!all(window, ".x-tab-strip-active .x-tab-strip-text").some((tab) => text(tab) === "Журнал")) return null;

    const grids = all(window, ".x-grid3").filter((grid) =>
      visible(grid) && grid.querySelector(".x-grid3-locked") && grid.querySelector(".x-grid3-unlocked")
    );
    const grid = grids.length === 1 ? grids[0] : null;
    const field = labeledField(window, /^Предмет\s*:?$/i);
    const groupInput = groupField(window);
    let group = clean(groupInput?.value);
    if (groupInput?.classList.contains("x-form-empty-field")) group = "";
    if (!groupInput) {
      const lists = groupLists();
      const recent = recentGroupList && lists.find(({list}) => list.id === recentGroupList);
      const hidden = (recent ? [recent] : lists).filter(({list}) => !visible(list))
        .flatMap(({list}) => all(list, ".x-combo-selected").map(text));
      const labels = hidden.length ? hidden : all(document, ".x-combo-list-inner .x-combo-selected")
        .map(text).filter((label) => courseSuffix.test(label));
      if (labels.length === 1) group = labels[0];
    }
    const period = readPeriod();
    return {window, grid, field, group, period, practical};
  }

  const masked = (scope) => all(document, ".ext-el-mask, .ext-el-mask-msg").some((element) => {
    if (!visible(element)) return false;
    if (!scope?.window || scope.window.contains?.(element)) return true;
    const parentWindow = element.closest?.(".x-window");
    return !parentWindow && Number(element.style.zIndex || 0) > Number(scope.window.style.zIndex || 0);
  });

  function readPage(scope = findScope()) {
    if (!scope?.grid || !scope.field || masked(scope)) return null;
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
  let navigating = false;
  let navigationController;
  let readingGroups = false;
  let catalogMessage = "";
  let manualStarted;
  let autoStarted;
  let catalogController;

  async function scan() {
    if (!manual || sending || auto.running || navigating) return;

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
    const left = scope.grid?.querySelector(".x-grid3-locked");
    const right = scope.grid?.querySelector(".x-grid3-unlocked");
    const leftRows = left ? rows(left) : [];
    const rightRows = right ? rows(right) : [];
    const row = rightRows[0];
    const stamp = JSON.stringify([
      leftRows.length, rightRows.length, text(leftRows[0]), text(row),
      right ? all(right, ".x-grid3-header .x-grid3-gcell").map(text) : []
    ]);
    return {grid: scope.grid, row, stamp};
  }

  function tableChanged(previous, current) {
    return previous.grid !== current.grid || previous.row !== current.row || previous.stamp !== current.stamp;
  }

  const groupName = (value) => clean(value).replace(courseSuffix, "").replace(/[–—]/g, "-");
  async function applyDates(range, signal, practical) {
    if (!range) return;
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!iso.test(range.from) || !iso.test(range.to) || range.from > range.to) {
      throw new Error("Дата начала должна быть не позднее даты окончания.");
    }
    const dates = [range.from, range.to];
    const before = await waitStable(() => {
      const scope = findScope(practical);
      const fields = dateFields(scope?.window);
      if (fields.some((field) => !field)) return null;
      const fieldIds = fields.map((field) => field.id);
      const period = pageCommand(null, "dateState", {fieldIds}).dates;
      return {key: JSON.stringify([fieldIds, period]), value: {fieldIds, period}};
    }, signal, "Откройте журнал и дождитесь появления полей «С» и «По».");
    if (before.period.every((value, i) => value === dates[i])) return;

    pageCommand(null, "setDates", {fieldIds: before.fieldIds, dates});
    await waitStable(() => {
      const scope = findScope(practical);
      const fields = dateFields(scope?.window);
      if (fields.some((field) => !field)) return null;
      const fieldIds = fields.map((field) => field.id);
      const actual = pageCommand(null, "dateState", {fieldIds}).dates;
      return actual.every((value, i) => value === dates[i]) ? {key: fieldIds.join(" "), value: true} : null;
    }, signal, "Журнал не подтвердил диапазон дат.");
  }

  async function openBatchGroup(target, signal, practical) {
    const previous = findScope(practical);
    const version = previous && tableVersion(previous);
    let opening;
    let selected = false;
    let pickerError = "";
    const manualAt = Date.now() + 10000;
    auto.message = "Открываем журнал группы…";

    return waitStable(() => {
      const period = readPeriod();
      if (period !== target.period) throw new Error("Учебный период на сайте изменился.");
      const active = findScope(practical);
      if (!active) return null;

      const isTarget = active.field && groupName(groupField(active.window)?.value) === groupName(target.name);
      const currentVersion = active && tableVersion(active);
      const fresh = !previous || active?.window !== previous.window || (currentVersion && tableChanged(version, currentVersion)) || groupName(previous.group) === groupName(target.name);
      if (isTarget && !pageCommand(active, "state").pickerBusy) {
        return {key: active.field.id, value: {mustRefresh: !fresh}};
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
        } catch (error) {
          pickerError = error.message;
        }
      }

      if (Date.now() >= manualAt) {
        auto.message = [pickerError, "Если группа не открылась, выберите её на сайте."].filter(Boolean).join(" ");
      }
      return null;
    }, signal, "Не удалось открыть журнал группы «" + target.name + "».", 650, 120000);
  }

  function activateJournalTab(window) {
    const tab = all(window, ".x-tab-strip-text").find((item) => visible(item) && text(item) === "Журнал");
    if (tab && !tab.closest(".x-tab-strip-active")) (tab.closest("a") ?? tab).click();
  }

  async function openJournal(practical, signal) {
    const title = journalTitle(practical);
    const current = journalWindows(practical)[0];
    if (!current) {
      const task = all(document, "#ux-taskbar button").find((button) => text(button) === title);
      const shortcut = task || all(document, "#x-shortcuts a").find((link) => text(link) === title);
      if (!shortcut) throw new Error("Не найден ярлык «" + title + "».");
      pageCommand(null, "ajax");
      shortcut.click();
    }
    let activated;
    return waitStable(() => {
      const window = journalWindows(practical)[0];
      if (!window) return null;
      if (activated !== window) {
        activated = window;
        pageCommand(null, "activateWindow", {id: window.id});
      }
      activateJournalTab(window);
      const scope = findScope(practical);
      return scope && groupField(scope.window) && dateFields(scope.window).every(Boolean)
        ? {key: scope.window.id, value: scope} : null;
    }, signal, "Не удалось открыть «" + title + "».");
  }

  async function collectMarked(groups, signal, range) {
    const period = readPeriod();
    const available = groups.filter((group) => group.origin === location.origin
      && (group.period === period || !group.period)).map((group) => ({...group, period}));
    const queue = [...new Map(available.map((group) => [groupName(group.name), group])).values()];
    if (!queue.length) throw new Error("Нет отмеченных групп для текущего сайта и учебного периода.");
    const failed = [];
    const journals = [false, true];
    auto.batch = {done: 0, total: queue.length * journals.length, group: "", journal: ""};
    for (const practical of journals) {
      signal.throwIfAborted();
      recentGroupList = undefined;
      auto.batch.journal = journalTitle(practical);
      auto.batch.group = "";
      auto.message = "Открываем журнал…";
      try {
        await openJournal(practical, signal);
        await applyDates(range, signal, practical);
      } catch (error) {
        signal.throwIfAborted();
        auto.batch.done += queue.length;
        failed.push(journalTitle(practical) + ": " + error.message);
        continue;
      }
      for (const group of queue) {
        signal.throwIfAborted();
        auto.batch.group = group.name;
        auto.saved = 0;
        auto.total = 0;
        try {
          const {mustRefresh} = await openBatchGroup(group, signal, practical);
          await applyDates(range, signal, practical);
          await collectGroup(signal, group, practical, mustRefresh, range);
        } catch (error) {
          signal.throwIfAborted();
          failed.push(journalTitle(practical) + " / " + group.name + ": " + error.message);
        }
        auto.batch.done++;
      }
    }
    auto.batch.group = auto.batch.journal = "";
    auto.batch.failed = failed.length;
    auto.saved = auto.total = 0;
    auto.message = failed.length
      ? "Сбор завершён с пропусками. " + failed.join(" · ")
      : "Сбор обоих журналов завершён.";
  }

  function limitLessons(journal, range) {
    const years = /^(\d{4})\s*[/-]\s*(\d{4})$/.exec(journal.period);
    if (!range || !years) return journal;
    const lessons = journal.lessons.filter(({date}) => {
      const [day, month, statedYear] = date.split(".");
      const year = statedYear
        ? (statedYear.length === 2 ? "20" + statedYear : statedYear)
        : years[Number(month) >= 9 ? 1 : 2];
      const iso = [year, month, day.padStart(2, "0")].join("-");
      return iso >= range.from && iso <= range.to;
    });
    return {...journal, lessons};
  }

  async function collectGroup(signal, target, practical, mustRefresh = false, range) {
    const start = findScope(practical);
    if (!start?.field) throw new Error("Откройте вкладку «Журнал» нужной группы.");
    if (target && groupName(start.group) !== groupName(target.name)) {
      throw new Error("Открылась другая группа. Сбор остановлен.");
    }
    let lastTabAttempt = 0;
    function groupScope() {
      let current = findScope(practical);
      if (!current && start.window.isConnected && journalWindows(start.practical)[0] === start.window
        && Date.now() - lastTabAttempt >= 1000) {
        lastTabAttempt = Date.now();
        activateJournalTab(start.window);
        current = findScope(practical);
      }
      if (!start.window.isConnected || (current && (current.window !== start.window
        || current.period !== start.period || (start.group && current.group && groupName(current.group) !== groupName(start.group))))) {
        throw new Error("Группа или учебный период сменились.");
      }
      if (target && groupName(groupField(current?.window)?.value) !== groupName(target.name)) return null;
      return current?.field ? current : null;
    }

    const initial = await waitStable(() => {
      const scope = groupScope();
      return scope && !pageCommand(scope, "state").pickerBusy
        ? {key: scope.field.id, value: scope} : null;
    }, signal, "Журнал группы не загрузился.");

    pageCommand(initial, "open");
    const options = await waitStable(() => {
      const scope = groupScope();
      if (!scope) return null;
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
      const alreadyOpen = !mustRefresh && pageCommand(current, "state").value === option.value
        && clean(current.field.value) === option.label;
      if (!alreadyOpen) pageCommand(current, "select", option);

      const journal = await waitStable(() => {
        const active = groupScope();
        if (!active || masked(active)) return null;
        const state = pageCommand(active, "state");
        if (state.busy || state.value !== option.value || clean(active.field.value) !== option.label) return null;
        if (!alreadyOpen && !tableChanged(previous, tableVersion(active))) return null;
        const data = readPage(active);
        return data ? {key: JSON.stringify(data), value: data} : null;
      }, signal, "Не дождались новой таблицы для предмета «" + option.label + "» за 60 секунд.");
      signal.throwIfAborted();
      const filtered = limitLessons(journal, range);
      await save(target ? {...filtered, group: target.name} : filtered, autoStarted);
      auto.saved++;
      mustRefresh = false;
    }
    auto.message = "Автосбор завершён.";
  }

  // Повторно используем проверенный механизм открытия групп и предметов,
  // вместо попытки выбирать записи Ext JS непосредственно из дашборда.
  async function navigateJournal(target, signal) {
    if (!target || target.origin !== location.origin || target.period !== readPeriod()
      || !target.group || !target.subject) {
      throw new Error("Сайт, учебный период, группа или предмет не соответствуют журналу очереди.");
    }
    const practical = target.kind === "practical";
    await openJournal(practical, signal);
    await openBatchGroup({period: target.period, name: target.group}, signal, practical);
    signal.throwIfAborted();
    const scope = await waitStable(() => {
      const active = findScope(practical);
      if (!active?.field || groupName(active.group) !== groupName(target.group)) return null;
      const status = pageCommand(active, "state");
      return !status.busy && !status.pickerBusy ? {key: active.field.id, value: active} : null;
    }, signal, "Не удалось выбрать группу «" + target.group + "».");

    const already = readPage(scope);
    const matching = (journal) => journal && clean(journal.subject) === clean(target.subject)
      && groupName(journal.group) === groupName(target.group)
      && journal.period === target.period;
    if (!matching(already)) {
      pageCommand(scope, "open");
      const options = await waitStable(() => {
        const active = findScope(practical);
        if (!active?.field || groupName(active.group) !== groupName(target.group)) return null;
        const state = pageCommand(active, "list");
        if (state.busy || !state.expanded || !state.items.length
          || state.total > state.items.length
          || state.rendered !== null && state.rendered !== state.items.length) return null;
        return {key: JSON.stringify(state.items), value: state.items};
      }, signal, "Не удалось загрузить список дисциплин.");
      const matches = options.filter(({label}) => clean(label) === clean(target.subject));
      if (matches.length !== 1) {
        throw new Error("В списке дисциплин не найден единственный предмет «" + target.subject + "».");
      }
      const current = findScope(practical);
      if (!current?.field || groupName(current.group) !== groupName(target.group))
        throw new Error("Группа изменилась во время выбора дисциплины.");
      pageCommand(current, "select", matches[0]);
    }
    const selected = await waitStable(() => {
      const active = findScope(practical);
      if (!active || masked(active)) return null;
      const state = pageCommand(active, "state");
      if (state.busy || state.pickerBusy) return null;
      const journal = readPage(active);
      return matching(journal) ? {key: JSON.stringify(journal), value: journal} : null;
    }, signal, "Не загрузился выбранный предмет «" + target.subject + "».");
    const ids = new Set(selected.lessons.map((lesson) => String(lesson.id)));
    const missing = (target.lessonIds || []).filter((id) => !ids.has(String(id)));
    if (missing.length) {
      throw new Error("В открытой таблице отсутствует " + missing.length +
        " занятий из сохранённого журнала. Проверьте диапазон дат БАРС и повторите сбор.");
    }
    return {
      group: selected.group, subject: selected.subject, kind: selected.kind || "theoretical",
      lessonCount: selected.lessons.length
    };
  }

  function handleMessage(message, sender, reply) {
    if (message.type === "navigateJournalCancel") {
      navigationController?.abort();
      reply({ok: true});
      return;
    }
    if (message.type === "navigateJournal") {
      if (navigating || auto.running || readingGroups) {
        reply({ok: false, error: "На вкладке БАРС уже выполняется навигация или сбор данных."});
        return;
      }
      navigating = true;
      navigationController = new AbortController();
      navigateJournal(message.journal, navigationController.signal)
        .then((result) => reply({ok: true, journal: result}),
          (error) => reply({ok: false, error: error.message}))
        .finally(() => {
          navigating = false;
          navigationController = undefined;
        });
      return true;
    }
    if (message.type !== "collectorStatus") return;
    if (message.manual !== undefined && !auto.running) {
      manual = message.manual;
      manualStarted = Date.now();
      lastSent = undefined;
      candidate = undefined;
    }
    if (message.stopAuto) controller?.abort();
    if (message.catalog && !auto.running && !readingGroups && !navigating) {
      readingGroups = true;
      catalogMessage = "Ожидание списка групп…";
      catalogController = new AbortController();
      collectGroups(catalogController.signal, Date.now()).then((result) => { catalogMessage = result; })
        .catch((error) => { catalogMessage = catalogController.signal.aborted ? "Сбор списка групп остановлен." : error.message; })
        .finally(() => { readingGroups = false; catalogController = undefined; });
    }
    if ((message.startAuto || message.markedGroups?.length || message.applyDates) && !auto.running && !readingGroups && !navigating) {
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
        if (message.applyDates && !journalWindows().length) await openJournal(false, signal);
        await applyDates(message.range, signal);
        if (message.applyDates) auto.message = "Диапазон дат применён. Можно выбирать группу.";
        else await collectGroup(signal, undefined, undefined, false, message.range);
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
    navigationController?.abort();
  });
  globalThis.collegeJournalCollector = true;
  chrome.runtime.onMessage.addListener(handleMessage);
  timer = setInterval(scan, 350);
})();
