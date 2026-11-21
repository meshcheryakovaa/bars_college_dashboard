const journalPrefix = "journal:";
const journals = new Map();
const journalFilter = document.querySelector("#journal-filter");
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
let view = "journals";
let loaded = false;

const contextHeaders = ["Группа (подсказка)", "Предмет", "Учебный период"];
const context = (journal) => [journal.group, journal.subject, journal.period];
const views = {
  journals: {
    title: "Журналы",
    headers: [...contextHeaders, "Студентов", "Занятий", "Последний сбор"],
    placeholder: "Предмет, группа или учебный период",
    rows: (journal) => [[...context(journal), journal.students.length, journal.lessons.length, formatTime(journal.savedAt)]]
  },
  students: {
    title: "Студенты",
    headers: ["№ по списку", "Ф. И. О.", "ID студента", ...contextHeaders],
    placeholder: "Ф. И. О., ID, предмет или группа",
    rows: (journal) => journal.students.map((student) =>
      [student.number, student.name, student.id, ...context(journal)]
    )
  },
  lessons: {
    title: "Занятия",
    headers: ["№ занятия", "Дата", "ID занятия", ...contextHeaders],
    placeholder: "Дата, ID, предмет или группа",
    rows: (journal) => journal.lessons.map((lesson) =>
      [lesson.number, lesson.date, lesson.id, ...context(journal)]
    )
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
  const entries = [...journals].sort(([, a], [, b]) => b.savedAt.localeCompare(a.savedAt));
  const studentIds = new Set();
  const lessonIds = new Set();
  const selection = journalFilter.value;
  const options = [makeOption("", "Все журналы")];
  for (const [key, journal] of entries) {
    for (const {id} of journal.students) studentIds.add(JSON.stringify([journal.origin, id]));
    for (const {id} of journal.lessons) lessonIds.add(JSON.stringify([journal.origin, id]));
    const label = [journal.subject, journal.group, journal.period].filter(Boolean).join(" · ");
    options.push(makeOption(key, label));
  }
  journalFilter.replaceChildren(...options);
  journalFilter.value = journals.has(selection) ? selection : "";
  journalFilter.disabled = !entries.length;

  document.querySelector("#journal-count").textContent = entries.length;
  document.querySelector("#student-count").textContent = studentIds.size;
  document.querySelector("#lesson-count").textContent = lessonIds.size;
  updated.textContent = entries.length
    ? "Последний сбор — " + formatTime(entries[0][1].savedAt) + ". Данные обновляются автоматически."
    : "Данные появятся здесь, когда расширение считает первый журнал.";

  renderTable();
}

function appendRow(parent, values, tag) {
  const row = document.createElement("tr");
  for (const value of values) {
    const cell = document.createElement(tag);
    cell.textContent = value === "" || value == null ? "—" : value;
    if (tag === "th") cell.scope = "col";
    row.append(cell);
  }
  parent.append(row);
}

function renderTable() {
  if (!loaded) return;
  const config = views[view];
  const terms = search.value.toLocaleLowerCase("ru").trim().split(/\s+/).filter(Boolean);
  const options = journalFilter.options;
  const selection = journalFilter.value;
  const selected = selection ? [selection] : [...options].slice(1).map((option) => option.value);
  const rows = selected.flatMap((key) => config.rows(journals.get(key))).filter((row) => {
    const content = row.join(" ").toLocaleLowerCase("ru");
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
  empty.textContent = journals.size
    ? "Записей по выбранным условиям нет."
    : "Откройте журнал на сайте колледжа и нажмите «Собрать журналы группы» в меню расширения.";
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

const changedDuringLoad = new Set();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let refresh = false;
  for (const [key, {newValue}] of Object.entries(changes)) {
    if (!key.startsWith(journalPrefix)) continue;
    if (newValue) journals.set(key, newValue);
    else journals.delete(key);
    if (!loaded) changedDuringLoad.add(key);
    refresh = true;
  }
  if (loaded && refresh) renderSummary();
});

chrome.storage.local.get(null).then((stored) => {
  for (const [key, record] of Object.entries(stored)) {
    if (key.startsWith(journalPrefix) && !changedDuringLoad.has(key)) journals.set(key, record);
  }
  changedDuringLoad.clear();
  loaded = true;
  renderSummary();
}).catch(() => {
  updated.textContent = "Не удалось прочитать журналы. Обновите вкладку и попробуйте снова.";
});
