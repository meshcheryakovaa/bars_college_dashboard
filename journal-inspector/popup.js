const statusLine = document.querySelector('#status');
const start = document.querySelector('#start');
const stop = document.querySelector('#stop');
const save = document.querySelector('#save');
let tab;
let report;
const command = type => chrome.tabs.sendMessage(tab.id, {type});
async function refresh() {
  const live = await command('status').catch(() => null);
  const key = 'tab-' + tab.id;
  report = live?.report ?? (await chrome.storage.session.get(key))[key];
  const recording = Boolean(live?.running);
  start.disabled = recording;
  stop.disabled = !recording;
  save.disabled = !report;
  statusLine.textContent = (recording ? 'Идёт запись' : report ? 'Запись завершена' : 'Готово к записи')
    + (report ? ' · действий ' + report.steps.length : '');
}
async function run(fn) {
  try { await fn(); await refresh(); }
  catch (e) { statusLine.textContent = 'Ошибка: ' + e.message; }
}
start.onclick = () => run(async () => {
  if (report && !confirm('Начать заново и заменить предыдущую запись этой вкладки?')) return;
  await chrome.scripting.executeScript({target:{tabId:tab.id}, files:['recorder.js']});
  await command('start');
});
stop.onclick = () => run(() => command('stop'));
save.onclick = () => run(async () => {
  await refresh();
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)], {type:'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'bars-inspection-' + report.started.replace(/[:.]/g,'-') + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
run(async () => { [tab] = await chrome.tabs.query({active:true,currentWindow:true}); });
