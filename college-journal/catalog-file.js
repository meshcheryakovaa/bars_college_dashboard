const fileStatus = document.querySelector("#file-status");
const connectFile = document.querySelector("#connect-file");
const downloadFile = document.querySelector("#download-file");
const fileName = "catalog-db.json";
let catalogFile;
let revision = 0;
let savedRevision = 0;
let writing = false;
let connecting = false;

async function getJson() {
  const data = catalogDocument(await chrome.storage.local.get(null));
  return JSON.stringify(data, null, 2) + "\n";
}

function fileBinding(mode, operation) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("catalog-file-binding", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("files", mode);
      const result = operation(transaction.objectStore("files"));
      transaction.oncomplete = () => { db.close(); resolve(result.result); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

async function persistCatalog() {
  if (!catalogFile || writing || connecting) return;
  writing = true;
  connectFile.disabled = true;
  try {
    while (savedRevision !== revision) {
      const version = revision;
      const write = async () => {
        const data = await getJson();
        const writer = await catalogFile.createWritable();
        try {
          await writer.write(data);
          await writer.close();
        } catch (error) {
          await writer.abort().catch(() => {});
          throw error;
        }
      };
      if (navigator.locks) await navigator.locks.request("catalog-db-write", write);
      else await write();
      savedRevision = version;
    }
    fileStatus.textContent = "БД обновляется в файле " + catalogFile.name + ", пока открыт дашборд.";
  } catch {
    catalogFile = undefined;
    fileStatus.textContent = "Запись файла недоступна. Выберите файл снова или скачайте БД.";
  } finally {
    writing = false;
    connectFile.disabled = false;
  }
}

connectFile.addEventListener("click", async () => {
  if (!window.showSaveFilePicker) return;
  connecting = true;
  connectFile.disabled = true;
  try {
    catalogFile = await window.showSaveFilePicker({
      suggestedName: fileName, types: [{description: "БД каталога (JSON)", accept: {"application/json": [".json"]}}]
    });
    await fileBinding("readwrite", (store) => store.put(catalogFile, fileName)).catch(() => {});
    revision++;
  } catch (error) {
    if (error.name !== "AbortError") fileStatus.textContent = "Доступ к файлу недоступен. Можно скачать БД.";
  } finally {
    connecting = false;
    connectFile.disabled = false;
    if (savedRevision !== revision) void persistCatalog();
  }
});

downloadFile.addEventListener("click", async () => {
  try {
    const url = URL.createObjectURL(new Blob([await getJson()], {type: "application/json"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch {
    fileStatus.textContent = "Не удалось скачать БД.";
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(changes).some((key) =>
    key.startsWith("journal:") || key.startsWith(groupPrefix) || key.startsWith(selectionPrefix) || key.startsWith("workflow:plan:") || key.startsWith("workflow:enrollment-skip:")
  )) {
    revision++;
    void persistCatalog();
  }
});

if (window.showSaveFilePicker) {
  fileStatus.textContent = "Для записи на диск укажите файл catalog-db.json в папке расширения.";
  fileBinding("readonly", (store) => store.get(fileName)).then(async (file) => {
    if (!file || connecting || catalogFile) return;
    if (await file.queryPermission({mode: "readwrite"}) === "granted" && !connecting && !catalogFile) {
      catalogFile = file;
      revision++;
      void persistCatalog();
    }
  }).catch(() => {});
} else {
  connectFile.hidden = true;
  fileStatus.textContent = "Скачанный файл catalog-db.json можно поместить в папку расширения.";
}
