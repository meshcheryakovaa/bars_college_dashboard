// Run with node tests/marked-journals.cjs. Only the page, Ext JS and Chrome are simulated.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const origin = "https://college.example";
const names = ["А-1-26р", "Б-2-26р"];
const range = {from: "2026-09-01", to: "2026-11-22"};
const windows = [], saved = [], byId = new Map(), widgets = new Map();
const events = new EventTarget();
let time = Date.now(), listener, recoveries = 0;

function node(props = {}) {
  return Object.assign({
    style: {}, classList: Object.assign([], {contains(c) { return this.includes(c); }}),
    getClientRects: () => [1], querySelectorAll(selector) { return this.nodes?.[selector] ?? []; },
    querySelector(selector) { return this.querySelectorAll(selector)[0]; },
    closest: () => null, matches: () => false, isConnected: true
  }, props);
}
function openWindow(practical) {
  const win = node({id: String(windows.length), contains: () => true, nodes: {}});
  windows.push(win);
  const title = practical ? "Журнал практических занятий" : "Журнал теоретических занятий";
  const tab = node({textContent: "Журнал", closest: sel => sel === ".x-tab-strip-active" && win.active ? tab : null,
    click() { win.active = true; recoveries++; }});
  const labels = [];
  function field(name, value) {
    const input = node({id: win.id + name, value, matches: s => s === "input"});
    labels.push(node({textContent: name, control: input}));
    byId.set(input.id, input);
    return input;
  }
  const from = field("С", "15.11.2026"), to = field("По", "29.11.2026");
  const group = field("Группа", ""), subject = field("Предмет", "");
  function combo(input, options, select) {
    let expanded = false;
    const store = {getRange: () => options().map(name => ({get: () => name}))};
    widgets.set(input.id, {store, displayField: "name", getValue: () => input.value,
      isExpanded: () => expanded, onTriggerClick() { expanded = true; },
      collapse() { expanded = false; }, onSelect(rec) { input.value = rec.get(); expanded = false; select(); }});
  }
  let grid;
  win.active = true;
  combo(group, () => names, () => {
    subject.value = ""; grid = null;
    if (group.value === names[1]) from.value = "15.11.2026";
  });
  combo(subject, () => ["Предмет " + group.value], () => {
    assert.equal(from.value, "01.09.2026"); assert.equal(to.value, "22.11.2026");
    win.active = false;
    const cells = ["№", "Ф.И.О.", "ID"].map((textContent,i) =>
      node({textContent, classList: ["x-grid3-td-" + i], style: {display: i === 2 ? "none" : ""}}));
    const row = node({nodes: {"td.x-grid3-cell": cells.map((c,i) =>
      node({...c, textContent: ["1","Студент","101"][i]}))}});
    const half = node({nodes: {".x-grid3-body > .x-grid3-row":[row], ".x-grid3-header td.x-grid3-hd.x-grid3-cell":cells}});
    grid = node({nodes: {".x-grid3-locked":[half], ".x-grid3-unlocked":[half]}});
  });
  win.querySelectorAll = s => ({
    "label": labels, ".x-window-header-text":[node({textContent:title})],
    ".x-tab-strip-text":[tab], ".x-tab-strip-active .x-tab-strip-text":win.active ? [tab] : [],
    ".x-grid3": grid ? [grid] : []
  })[s] ?? [];
}
const doc = Object.assign(events, node());
const period = "2026/2027";
doc.querySelectorAll = s => ({
  ".x-window": windows,
  "#x-desktop .widget .title":[node({textContent:"Период обучения",nextElementSibling:node({textContent:period})})],
  "#x-shortcuts a":[false,true].map(p => node({textContent:p ? "Журнал практических занятий" : "Журнал теоретических занятий",click:()=>openWindow(p)})),
  ".ext-el-mask, .ext-el-mask-msg":windows.length && !windows.at(-1).querySelector(".x-grid3") ? [node({style:{zIndex:"100"}})] : []
})[s] ?? [];
doc.getElementById = id => byId.get(id);
const context = vm.createContext({document:doc, location:{origin}, getComputedStyle:()=>({visibility:"visible"}),
  Date:class extends Date {static now(){return time;}}, Event, CustomEvent, AbortController, console,
  setInterval(){}, setTimeout(fn,ms){time+=ms; setImmediate(fn);},
  chrome:{storage:{onChanged:{addListener(){}}},runtime:{onMessage:{addListener(fn){listener=fn;}},
    async sendMessage(m){if (m.journal) saved.push(m.journal); return {ok:true};}}}});
context.window = context;
context.Ext = {Ajax:{on(){},isLoading:()=>false},getCmp:id=>widgets.get(id)};
for (const file of ["journal-page.js","collector.js"])
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../college-journal",file),"utf8"),context);
function status(options={}) {
  let result;
  listener({type:"collectorStatus",...options},{},value=>{result=value;});
  return result.auto;
}
(async () => {
  status({markedGroups:names.map(name=>({name,origin,period})),range});
  while (status().running) await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(saved.map(j=>[j.kind ?? "theory",j.group,j.subject]),
    ["theory","practical"].flatMap(k=>names.map(n=>[k,n,"Предмет "+n])), status().message);
  assert.equal(status().batch.done,4);
  assert.equal(status().batch.failed,0);
  assert.equal(recoveries,4);
  console.log("OK: both journals, date resets, four group selections and tab recoveries");
})().catch(e=>{console.error(e);process.exitCode=1;});
