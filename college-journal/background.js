importScripts("catalog.js");

let pending = Promise.resolve();

async function journalId(identity) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(identity)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function saveJournal(journal, tabId) {
  const {origin, period, subject, group} = journal;
  const ids = journal.students.map(({id}) => id).sort();
  const identity = [origin, period, subject, ids];
  if (journal.kind === "practical") identity.push(journal.kind);
  let id = await journalId(identity);
  let key = "journal:" + id;
  let previous = (await chrome.storage.local.get(key))[key];
  // Keep existing keys and separate otherwise identical journals in known different groups.
  if (group && previous?.group && groupKey(origin, period, group) !== groupKey(origin, period, previous.group)) {
    id = await journalId([...identity, groupKey(origin, period, group)]);
    key = "journal:" + id;
    previous = (await chrome.storage.local.get(key))[key];
  }
  const lessons = new Map((previous?.lessons ?? []).map((lesson) => [lesson.id, lesson]));
  for (const lesson of journal.lessons) lessons.set(lesson.id, lesson);
  const record = {
    ...journal,
    group: journal.group || previous?.group || "",
    lessons: [...lessons.values()],
    id,
    savedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({[key]: record});
  const records = await chrome.storage.local.getKeys();
  const count = records.filter((name) => name.startsWith("journal:")).length;
  await chrome.action.setBadgeText({tabId, text: String(count)}).catch(() => {});
}

async function saveCatalog({origin, period, groups}) {
  const keys = groups.map(({name}) => groupPrefix + groupKey(origin, period, name));
  const stored = await chrome.storage.local.get(keys);
  const records = {};
  for (const [index, group] of groups.entries()) {
    const storageKey = keys[index];
    const previous = stored[storageKey];
    records[storageKey] = {
      key: storageKey.slice(groupPrefix.length), origin, period, name: previous?.name || group.name,
      disciplines: group.disciplines ?? previous?.disciplines ?? []
    };
  }
  await chrome.storage.local.set(records);
}

async function clearDashboard() {
  const keys = (await chrome.storage.local.getKeys()).filter((key) =>
    key.startsWith("journal:") || key.startsWith("catalog:") || key.startsWith("workflow:plan:")
    || key === "workflow:favorite-journals" || key === "workflow:stop-on-errors");
  await chrome.storage.local.set({"dashboard:cleared-at": Date.now()});
  await chrome.storage.local.remove(keys);
  await chrome.action.setBadgeText({text: ""}).catch(() => {});
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(({id}) => chrome.action.setBadgeText({tabId: id, text: ""})));
}

async function saveFromTab(message, tabId) {
  const cutoff = (await chrome.storage.local.get("dashboard:cleared-at"))["dashboard:cleared-at"];
  if (cutoff && (!message.startedAt || message.startedAt <= cutoff)) {
    throw new Error("База очищена. Запустите новый сбор.");
  }
  if (message.type === "saveJournal") await saveJournal(message.journal, tabId);
  else await saveCatalog(message.catalog);
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const clear = message.type === "clearDashboard"
    && sender.url?.split("?")[0] === chrome.runtime.getURL("dashboard.html");
  const save = sender.tab?.id !== undefined && ["saveJournal", "saveCatalog"].includes(message.type);
  if (!clear && !save) return;
  const operation = pending.then(() => clear ? clearDashboard() : saveFromTab(message, sender.tab.id));
  pending = operation.catch(() => {});
  operation.then(() => reply({ok: true}), (error) => reply({ok: false, error: error.message}));
  return true;
});
