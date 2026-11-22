const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = (name) => fs.readFileSync(path.join(__dirname, "..", "college-journal", name), "utf8");
const task = {
  origin: "https://college.72to.ru", period: "2026-2027",
  group: "СП-1-26р - 1 курс", subject: "БД.05 Информатика",
  practical: true, lessonId: "lesson-15", date: "15.09", number: "1"
};
const student = {id: "student-17", name: "Иванов Иван Иванович"};
const alert = "На 15.09.2026 студент Иванов Иван Иванович не числится в группе СП-1-26р";
const pure = {};
vm.runInNewContext(read("enrollment-skip.js"), pure);
const model = pure.__barsEnrollmentSkip;
assert(model.matchWarning(alert, task, student.name));
assert(!model.matchWarning(alert.replace("15.09.2026", "22.09.2026"), task, student.name));
assert(!model.matchWarning(alert.replace("Иванов Иван Иванович", "Петров Петр Петрович"), task, student.name));
assert(!model.matchWarning(alert.replace("СП-1-26р", "СП-2-26р"), task, student.name));
assert(!model.matchWarning("Нельзя выставить оценку: студенту запрещено", task, student.name));
assert(!model.parseWarning("На 15.09.2026 студент Иванов Иван Иванович не числится в группе СП-1-26р. Сохраните данные?"));
assert.equal(model.fullDate("15.02", "2026-2027"), "15.02.2027");

const skip = {
  lessonId: task.lessonId, studentId: student.id, studentName: student.name,
  checkedAt: "2026-11-22T18:00:00Z", lessonDate: "15.09.2026",
  reason: "not-enrolled-on-lesson-date", warning: alert
};
const values = ["3", "4", "5", ""], students = ["s1", "s2", "s3", student.id];
const status = model.evaluate(values, students, {[student.id]: skip}, task);
assert.equal(status.status, "complete");
assert.equal(status.counts.scored, 3);
assert.equal(status.counts.skippedNonEnrolled, 1);
assert.equal(status.counts.nonThree, 2);
assert.equal(status.counts.empty, 0);
assert.equal(model.evaluate(values, students, {[student.id]: skip},
  {...task, lessonId: "lesson-16"}).status, "incomplete",
  "A skip must be specific to the lesson ID.");
assert.equal(model.evaluate(values, students, {}, task).status, "incomplete",
  "Removing a skip must permit re-evaluation.");
assert.equal(model.evaluate(["3", "", "5", ""], students,
  {[student.id]: skip}, task).status, "incomplete",
  "Other blank students still prevent grade verification.");

function fakeWindow() {
  const listeners = new Map();
  const wnd = {
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {listeners.get(name)?.delete(fn);},
    postMessage(payload) {
      if (payload?.channel === "bars-enrollment-skip-v1" && payload.kind === "persist") {
        setTimeout(() => {
          const event = {source: wnd, origin: task.origin, data: {
            channel: payload.channel, kind: "ack", requestId: payload.requestId,
            ok: true, skip
          }};
          for (const fn of [...(listeners.get("message") || [])]) fn(event);
        }, 4);
      }
    },
    emit(data) {
      return Promise.all([...(listeners.get("message") || [])].map(fn =>
        fn({source: wnd, origin: task.origin, data})));
    }
  };
  return wnd;
}

(async () => {
  // Real isolated-world bridge: independently checks journal + lesson + student
  // before writing the durable skip and acknowledging the page.
  const windowBridge = fakeWindow();
  const stored = {"journal:test": {
    ...task, kind: "practical",
    lessons: [{id: task.lessonId, date: task.date}],
    students: [{id: student.id, name: student.name}]
  }};
  let writes = 0, lastAck;
  windowBridge.postMessage = (message) => { if (message.kind === "ack") lastAck = message; };
  const bridge = {
    window: windowBridge, location: {origin: task.origin},
    chrome: {storage: {local: {
      get: async () => stored,
      set: async (object) => {Object.assign(stored, object);writes++;}
    }}},
    Date
  };
  vm.createContext(bridge);
  vm.runInContext(read("enrollment-skip.js"), bridge);
  vm.runInContext(read("enrollment-skip-bridge.js"), bridge);
  const request = {
    channel: "bars-enrollment-skip-v1", kind: "persist", requestId: "test-1",
    task, studentId: student.id, studentName: student.name, warning: alert
  };
  await windowBridge.emit(request);
  assert.equal(lastAck.ok, true);
  assert.equal(writes, 1);
  assert.equal(stored[model.storageKey(task, student.id)].reason,
    "not-enrolled-on-lesson-date");
  await windowBridge.emit({...request, requestId: "test-2",
    warning: alert.replace(student.name, "Другой Студент")});
  assert.equal(lastAck.ok, false);
  assert.equal(writes, 1);
  // A warning about a different lesson is never accepted by the bridge.
  await windowBridge.emit({...request, requestId: "test-3",
    task: {...task, lessonId: "some-other-lesson"}});
  assert.equal(lastAck.ok, false);
  assert.equal(writes, 1);

  // Execute the ACTUAL page observer. With no save_lesson_score reply, it
  // must handle the matching warning promptly and click exactly one OK.
  function simulatedPage(message, hasResponse = false) {
    const win = fakeWindow();
    const journalWin = {isConnected: true, style: {zIndex: "10"}, getClientRects: () => [1],
      querySelector: (sel) => sel === ".x-window-header-text"
        ? {textContent: "Журнал практических занятий"} : null};
    let open = true, clicks = 0;
    const button = {isConnected: true, disabled: false, getClientRects: () => [1],
      textContent: "ОК", click() {clicks++;open = false;}};
    const modal = {isConnected: true, style: {zIndex: "100"},
      getClientRects: () => open ? [1] : [],
      querySelector(sel) {
        if (sel === ".x-window-header-text") return {textContent: "Предупреждение"};
        if (sel === ".ext-mb-text") return {textContent: message};
        return null;
      },
      querySelectorAll(sel) {return sel === "button" ? [button] : [];}
    };
    const ctx = {
      document: {querySelectorAll: () => [journalWin, modal]},
      location: {origin: task.origin}, crypto: {randomUUID: () => "test-random"},
      setTimeout, clearTimeout, URL, Date, MouseEvent: function() {}
    };
    Object.assign(ctx, win);
    ctx.window = ctx;
    // Bridge ACK is delivered after simulated background persistence.
    ctx.postMessage = (msg) => {
      if (msg.kind !== "persist") return;
      setTimeout(() => {
        for (const fn of [...(ctx.events || [])]) fn({
          source: ctx, origin: task.origin,
          data: {channel: msg.channel, kind: "ack", requestId: msg.requestId,
            ok: true, skip}
        });
      }, 4);
    };
    ctx.events = new Set();
    ctx.addEventListener = (name, fn) => {if(name==="message")ctx.events.add(fn);};
    ctx.removeEventListener = (name, fn) => {if(name==="message")ctx.events.delete(fn);};
    vm.createContext(ctx);
    vm.runInContext(read("enrollment-skip.js"), ctx);
    vm.runInContext(read("lesson-actions-page.js"), ctx);
    const net = {entries: hasResponse ? [{path: "/save_lesson_score", error: ""}] : []};
    const promise = ctx.__barsLessonActions.waitForScoreOrNotice(task, {win: journalWin},
      net, 0, student);
    return {promise, getClicks: () => clicks, modal};
  }
  const valid = simulatedPage(alert);
  const observed = await valid.promise;
  assert.equal(observed.kind, "skipped");
  assert.equal(valid.getClicks(), 1);
  assert.equal(observed.skip.studentId, student.id);

  const invalid = simulatedPage("Внимание! Оценка не сохранена: занятие заблокировано");
  await assert.rejects(invalid.promise, /другое предупреждение/);
  assert.equal(invalid.getClicks(), 0,
    "Unrelated warning MUST remain open without clicking OK.");

  const wrongStudent = simulatedPage(
    alert.replace(student.name, "Петров Петр Петрович"));
  await assert.rejects(wrongStudent.promise, /другое предупреждение/);
  assert.equal(wrongStudent.getClicks(), 0);

  const simultaneous = simulatedPage(alert, true);
  const observedAfterSave = await simultaneous.promise;
  assert.equal(observedAfterSave.kind, "skipped",
    "An alert must win even when save response arrives first.");
  assert.equal(simultaneous.getClicks(), 1);
  console.log("PASS: exact warning, durable per-lesson skip, no AJAX hang, no unrelated OK, 4/5");
})().catch((error) => {console.error(error);process.exitCode = 1;});
