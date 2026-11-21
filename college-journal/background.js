let pending = Promise.resolve();

async function saveJournal(journal, tabId) {
  const ids = journal.students.map(({id}) => id).sort();
  const identity = JSON.stringify([journal.origin, journal.period, journal.subject, ids]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = "journal:" + id;
  const previous = (await chrome.storage.local.get(key))[key];
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

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type !== "saveJournal" || sender.tab?.id === undefined) return;
  const operation = pending.then(() => saveJournal(message.journal, sender.tab.id));
  pending = operation.catch(() => {});
  operation.then(() => reply({ok: true}), (error) => reply({ok: false, error: error.message}));
  return true;
});
