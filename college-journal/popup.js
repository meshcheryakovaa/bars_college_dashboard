const status = document.querySelector("#status");
const totals = document.querySelector("#totals");
const last = document.querySelector("#last");
const toggle = document.querySelector("#toggle");
const autoButton = document.querySelector("#auto");
const autoStatus = document.querySelector("#auto-status");
const download = document.querySelector("#download");

let tabId;
let running = false;
let autoRunning = false;
let busy = false;
let records = [];

async function showRecords() {
  const stored = await chrome.storage.local.get(null);
  records = Object.entries(stored).filter(([key]) => key.startsWith("journal:"))
    .map(([, record]) => record).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const studentIds = new Set(records.flatMap((item) =>
    item.students.map(({id}) => JSON.stringify([item.origin, id]))
  ));
  const lessons = new Set(records.flatMap((item) =>
    item.lessons.map(({id}) => JSON.stringify([item.origin, id]))
  ));
  totals.textContent = `Журналы: ${records.length} · Студенты: ${studentIds.size} · Занятия: ${lessons.size}`;
  download.disabled = !records.length;
  last.textContent = records.length ? "Последний журнал — " + records[0].subject : "";
}

function showMode(state) {
  running = Boolean(state?.running);
  autoRunning = Boolean(state?.auto?.running);
  status.textContent = autoRunning
    ? "Автосбор идёт в этой вкладке."
    : running
      ? "Ручной сбор включён. Открывайте журналы в этой вкладке."
      : "Откройте вкладку «Журнал» нужной группы на сайте колледжа.";
  toggle.textContent = running ? "Остановить ручной сбор" : "Запустить ручной сбор";
  autoButton.textContent = autoRunning ? "Остановить автосбор" : "Собрать журналы группы";
  const progress = state?.auto;
  const count = progress?.total ? `${progress.saved} из ${progress.total}. ` : "";
  const batch = progress?.batch;
  const prefix = batch ? `Группы: ${batch.done} из ${batch.total}. ${batch.group ? batch.group + ". " : ""}` : "";
  autoStatus.textContent = progress?.message ? prefix + count + progress.message : "";
  toggle.disabled = busy || autoRunning || tabId === undefined;
  autoButton.disabled = busy || tabId === undefined;
}

async function sendCollector(action = {}) {
  return chrome.tabs.sendMessage(tabId, {type: "collectorStatus", ...action});
}

async function operate(action, inject = false) {
  if (busy) return;
  busy = true;
  toggle.disabled = autoButton.disabled = true;
  try {
    if (inject) {
      if (action.startAuto) {
        const stored = await chrome.storage.local.get(rangeKey);
        action.range = dateRange(stored[rangeKey]);
        await chrome.scripting.executeScript({target: {tabId}, world: "MAIN", files: ["journal-page.js"]});
      }
      await chrome.scripting.executeScript({target: {tabId}, files: ["collector.js"]});
    }
    const state = await sendCollector(action);
    busy = false;
    showMode(state);
  } catch (error) {
    busy = false;
    toggle.disabled = autoRunning;
    autoButton.disabled = false;
    status.textContent = "Не удалось запустить действие. " + error.message;
  }
}

toggle.addEventListener("click", () => void operate({manual: !running}, !running));
autoButton.addEventListener("click", () => {
  const action = autoRunning ? {stopAuto: true} : {startAuto: true};
  void operate(action, !autoRunning);
});

document.querySelector("#dashboard").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({url: chrome.runtime.getURL("dashboard.html") + (tabId === undefined ? "" : "?sourceTab=" + tabId)});
  } catch (error) {
    status.textContent = "Не удалось открыть дашборд. " + error.message;
  }
});

download.addEventListener("click", async () => {
  download.disabled = true;
  try {
    const file = await makeWorkbook(records);
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "college-journals.xlsx";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    status.textContent = "Не удалось выгрузить Excel. " + error.message;
  } finally {
    download.disabled = !records.length;
  }
});

chrome.storage.onChanged.addListener(() => void showRecords());
let refreshing = false;
async function refreshStatus() {
  if (busy || refreshing || tabId === undefined) return;
  refreshing = true;
  try {
    const state = await sendCollector().catch(() => null);
    if (!busy && (state || running || autoRunning)) showMode(state);
  } finally {
    refreshing = false;
  }
}

(async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  tabId = tab?.id;
  const state = tabId === undefined ? null : await sendCollector().catch(() => null);
  showMode(state);
  setInterval(refreshStatus, 850);
  await showRecords();
})();
