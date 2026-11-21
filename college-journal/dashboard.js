const journalFilter = document.querySelector("#journal-filter");
const journalLabel = document.querySelector("#journal-label");
const selectedOnly = document.querySelector("#selected-only");
const selectedCount = document.querySelector("#selected-count");
const search = document.querySelector("#search");
const updated = document.querySelector("#updated");
const table = document.querySelector("#results");
const head = table.querySelector("thead");
const body = table.querySelector("tbody");
const tableWrap = document.querySelector("#table-wrap");
const empty = document.querySelector("#empty");
const resultCount = document.querySelector("#result-count");
const viewButtons = [...document.querySelectorAll("[data-view]")];
const dateTime = new Intl.DateTimeFormat("ru", {dateStyle: "short", timeStyle: "medium"});
const storageState = {};
let view = "groups";
let loaded = false;
let context;

const groupColumns = (group) => [group.name, group.period];
const journalColumns = (journal) => [journal.group, journal.subject, journal.period];
const journalViews = new Set(["journals", "lessons"]);
const views = {
  groups: {
    title: "Группы",
    headers: ["Для анализа", "Группа", "Учебный период", "Дисциплин", "Студентов"],
    placeholder: "Название группы или учебный период",
    rows: ({groups}) => groups.map((group) => [
      {group}, ...groupColumns(group), group.disciplines.size, group.students.size
    ])
  },
  subjects: {
    title: "Дисциплины",
    headers: ["Дисциплина", "ID в списке", "Группа", "Учебный период"],
    placeholder: "Название дисциплины, ID или группа",
    rows: ({groups}) => groups.flatMap((group) => [...group.disciplines.values()].map((item) =>
      [item.name, item.id, ...groupColumns(group)]
    ))
  },
  students: {
    title: "Студенты",
    headers: ["Ф. И. О.", "ID студента", "Группа", "Учебный период"],
    placeholder: "Ф. И. О., ID или группа",
    rows: ({groups, unassigned}) => [
      ...groups.flatMap((group) => [...group.students.values()].map((item) =>
        [item.name, item.id, ...groupColumns(group)]
      )),
      ...unassigned.map((item) => [item.name, item.id, "", item.period])
    ]
  },
  journals: {
    title: "Журналы",
    headers: ["Группа", "Предмет", "Учебный период", "Студентов", "Занятий", "Последний сбор"],
    placeholder: "Предмет, группа или учебный период",
    rows: ({journals}) => journals.map((item) => [
      ...journalColumns(item), item.students.length, item.lessons.length, formatTime(item.savedAt)
    ])
  },
  lessons: {
    title: "Занятия",
    headers: ["№ занятия", "Дата", "ID занятия", "Группа", "Предмет", "Учебный период"],
    placeholder: "Дата, ID, предмет или группа",
    rows: ({journals}) => journals.flatMap((journal) => journal.lessons.map((item) =>
      [item.number, item.date, item.id, ...journalColumns(journal)]
    ))
  }
};

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : dateTime.format(date);
}

function makeOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function renderSummary() {
  const {groups, selected, unassigned} = catalogFromStorage(storageState);
  const only = selectedOnly.checked;
  const filteredGroups = [...groups.values()].filter(({key}) => !only || selected.has(key))
    .sort((a, b) => a.name.localeCompare(b.name, "ru", {numeric: true}));
  const entries = Object.entries(storageState).filter(([key, journal]) => key.startsWith("journal:")
    && (!only || selected.has(groupKey(journal.origin, journal.period, journal.group))))
    .sort(([, a], [, b]) => b.savedAt.localeCompare(a.savedAt));
  const studentIds = new Set();
  const lessonIds = new Set();
  const subjectNames = new Set(filteredGroups.flatMap((group) => [...group.disciplines.keys()]));
  const selection = journalFilter.value;
  const options = [makeOption("", "Все журналы")];

  for (const [key, journal] of entries) {
    for (const student of journal.students) {
      const id = JSON.stringify([journal.origin, student.id]);
      studentIds.add(id);
    }
    for (const {id} of journal.lessons) lessonIds.add(JSON.stringify([journal.origin, id]));
    subjectNames.add(journal.subject);
    const label = [journal.subject, journal.group, journal.period].filter(Boolean).join(" · ");
    options.push(makeOption(key, label));
  }
  journalFilter.replaceChildren(...options);
  journalFilter.value = entries.some(([key]) => key === selection) ? selection : "";
  journalFilter.disabled = !entries.length;

  for (const [id, value] of Object.entries({
    "group-count": filteredGroups.length, "subject-count": subjectNames.size, "journal-count": entries.length,
    "student-count": studentIds.size, "lesson-count": lessonIds.size
  })) document.querySelector("#" + id).textContent = value;
  selectedCount.textContent = `Отмечено групп — ${selected.size}`;
  updated.textContent = entries.length
    ? "Последний сбор журнала — " + formatTime(entries[0][1].savedAt)
    : "Собранные данные хранятся в этом профиле браузера.";

  updateMarkedButton();
  context = {groups: filteredGroups, entries, unassigned: only ? [] : [...unassigned.values()], selected};
  renderTable();
}

function groupCheckbox(group) {
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = context.selected.has(group.key);
  checkbox.setAttribute("aria-label", "Для анализа — " + group.name + " · " + group.period);
  checkbox.addEventListener("change", async () => {
    const key = selectionPrefix + group.key;
    checkbox.disabled = true;
    try {
      if (checkbox.checked) await chrome.storage.local.set({[key]: true});
      else await chrome.storage.local.remove(key);
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      updated.textContent = "Не удалось сохранить выбор группы. " + error.message;
    } finally {
      checkbox.disabled = false;
    }
  });
  return checkbox;
}

function appendRow(parent, values, tag) {
  const row = document.createElement("tr");
  for (const value of values) {
    const cell = document.createElement(tag);
    if (value?.group) cell.append(groupCheckbox(value.group));
    else cell.textContent = value === "" || value == null ? "—" : value;
    if (tag === "th") cell.scope = "col";
    row.append(cell);
  }
  parent.append(row);
}

function renderTable() {
  if (!loaded) return;
  const config = views[view];
  const terms = search.value.toLocaleLowerCase("ru").trim().split(/\s+/).filter(Boolean);
  const useJournalFilter = journalViews.has(view);
  journalLabel.hidden = !useJournalFilter;
  const selection = useJournalFilter ? journalFilter.value : "";
  const journals = context.entries.filter(([key]) => !selection || key === selection).map(([, item]) => item);
  const rows = config.rows({...context, journals}).filter((row) => {
    const content = row.filter((cell) => typeof cell !== "object").join(" ").toLocaleLowerCase("ru");
    return terms.every((term) => content.includes(term));
  });

  table.setAttribute("aria-label", config.title);
  search.placeholder = config.placeholder;
  head.replaceChildren();
  appendRow(head, config.headers, "th");
  const fragment = document.createDocumentFragment();
  for (const row of rows) appendRow(fragment, row, "td");
  body.replaceChildren(fragment);
  tableWrap.hidden = rows.length === 0;
  empty.hidden = rows.length !== 0;
  empty.textContent = selectedOnly.checked && !context.selected.size
    ? "Отметьте группы на вкладке «Группы» при выключенном фильтре."
    : "Записей по выбранным условиям пока нет.";
  resultCount.textContent = rows.length ? "Строк в таблице — " + rows.length.toLocaleString("ru") : "";
}

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    view = button.dataset.view;
    for (const item of viewButtons) item.setAttribute("aria-pressed", String(item === button));
    renderTable();
  });
}
journalFilter.addEventListener("change", renderTable);
search.addEventListener("input", renderTable);
selectedOnly.addEventListener("change", () => {
  renderSummary();
  void chrome.storage.local.set({"catalog:show-selected": selectedOnly.checked}).catch((error) => {
    updated.textContent = "Не удалось сохранить фильтр. " + error.message;
  });
});

const changedDuringLoad = new Set();
const isCatalogEntry = (key) => key.startsWith("journal:") || key.startsWith("catalog:");
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let refresh = false;
  for (const [key, {newValue}] of Object.entries(changes)) {
    if (!isCatalogEntry(key)) continue;
    if (newValue !== undefined) storageState[key] = newValue;
    else delete storageState[key];
    if (!loaded) changedDuringLoad.add(key);
    if (key === "catalog:show-selected") selectedOnly.checked = Boolean(newValue);
    refresh = true;
  }
  if (loaded && refresh) renderSummary();
});

selectedOnly.disabled = true;
chrome.storage.local.get(null).then((stored) => {
  for (const [key, record] of Object.entries(stored)) {
    if (isCatalogEntry(key) && !changedDuringLoad.has(key)) storageState[key] = record;
  }
  changedDuringLoad.clear();
  selectedOnly.checked = Boolean(storageState["catalog:show-selected"]);
  selectedOnly.disabled = false;
  loaded = true;
  renderSummary();
}).catch(() => {
  updated.textContent = "Не удалось прочитать справочник. Обновите вкладку.";
});

const sourceStatus = document.querySelector("#source-status");
const readGroups = document.querySelector("#read-groups");
const collectGroup = document.querySelector("#collect-group");
const collectMarked = document.querySelector("#collect-marked");
const openSource = document.querySelector("#open-source");
const source = new URLSearchParams(location.search).get("sourceTab");
const sourceTab = /^\d+$/.test(source ?? "") ? Number(source) : undefined;
let sourceBusy = false;
let sourceRun = false;
let batchRun = false;
let readingSource = false;
let sourceError = "";

function sendSource(action) {
  return chrome.tabs.sendMessage(sourceTab, {type: "collectorStatus", ...action});
}

function markedGroups() {
  const {groups, selected} = catalogFromStorage(storageState);
  return [...groups.values()].filter(({key}) => selected.has(key))
    .sort((a, b) => a.name.localeCompare(b.name, "ru", {numeric: true}))
    .map(({origin, period, name}) => ({origin, period, name}));
}

function updateMarkedButton() {
  collectMarked.disabled = sourceBusy || sourceTab === undefined || readingSource
    || (sourceRun ? !batchRun : !markedGroups().length);
  collectMarked.textContent = batchRun ? "Остановить сбор групп" : "Собрать отмеченные группы";
}

function showSource(state) {
  sourceRun = Boolean(state?.auto?.running);
  batchRun = sourceRun && Boolean(state?.auto?.batch);
  readingSource = Boolean(state?.readingGroups);
  updateMarkedButton();
  readGroups.disabled = sourceBusy || sourceTab === undefined || sourceRun || Boolean(state?.readingGroups);
  collectGroup.disabled = sourceBusy || sourceTab === undefined || readingSource || batchRun;
  openSource.disabled = sourceTab === undefined;
  collectGroup.textContent = sourceRun && !batchRun ? "Остановить автосбор" : "Собрать открытую группу";
  const progress = state?.auto;
  const autoText = progress?.message && [progress.total ? `${progress.saved} из ${progress.total}.` : "", progress.message].filter(Boolean).join(" ");
  const batch = progress?.batch;
  const batchText = batch && [`Группы: ${batch.done} из ${batch.total}`, batch.group].filter(Boolean).join(" · ");
  sourceStatus.textContent = sourceError || [
    batchText, autoText, !progress?.running && !batch ? state?.catalogMessage : null
  ].filter(Boolean).join(" · ") || (sourceTab === undefined
    ? "Откройте дашборд из меню расширения на вкладке колледжа, чтобы управлять сбором."
    : "Раскройте список групп на сайте колледжа, затем нажмите «Считать список групп».");
}

async function operateSource(action) {
  if (sourceBusy || sourceTab === undefined) return;
  sourceBusy = true;
  sourceError = "";
  readGroups.disabled = collectGroup.disabled = collectMarked.disabled = true;
  let state;
  try {
    const target = {tabId: sourceTab};
    if (action.startAuto || action.markedGroups) {
      await chrome.scripting.executeScript({target, world: "MAIN", files: ["journal-page.js"]});
    }
    if (action.startAuto || action.markedGroups || action.catalog) {
      await chrome.scripting.executeScript({target, files: ["collector.js"]});
    }
    state = await sendSource(action);
  } catch {
    sourceError = "Связь с журналом недоступна. Откройте дашборд заново из вкладки колледжа.";
  } finally {
    sourceBusy = false;
    showSource(state);
  }
}

readGroups.addEventListener("click", () => void operateSource({catalog: true}));
collectMarked.addEventListener("click", () => {
  if (batchRun) void operateSource({stopAuto: true});
  else {
    const groups = markedGroups();
    if (groups.length) void operateSource({markedGroups: groups});
  }
});
collectGroup.addEventListener("click", () => void operateSource(sourceRun ? {stopAuto: true} : {startAuto: true}));
openSource.addEventListener("click", async () => {
  try {
    const tab = await chrome.tabs.update(sourceTab, {active: true});
    await chrome.windows.update(tab.windowId, {focused: true});
  } catch {
    sourceError = "Вкладка колледжа закрыта. Откройте дашборд заново из меню расширения.";
    showSource();
  }
});
showSource();
if (sourceTab !== undefined) {
  setInterval(async () => {
    if (sourceBusy) return;
    const state = await sendSource().catch(() => null);
    if (!sourceBusy) showSource(state);
  }, 850);
}
