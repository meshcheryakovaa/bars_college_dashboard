const fields = [
  ['group', 'Группа', 'СП-1-25р - 1 курс'],
  ['course', 'Курс', '1'],
  ['period', 'Период', '2025/2026'],
  ['specialty', 'Специальность', '15.02.19 - Сварочное производство'],
  ['code', 'Код специальности', '15.02.19'],
  ['subject', 'Предмет', 'БД.05 Информатика (Республика)'],
  ['teacher', 'Преподаватель', 'Мещеряков Александр Ахатович'],
  ['mdk', 'МДК', ''], ['section', 'Раздел МДК', ''],
  ['approval', 'Номер утверждения', '1'], ['date', 'Дата утверждения', '31.08.2025'],
  ['autumn', 'Наименование · осень', ''], ['spring', 'Наименование · весна', '']
];
const initial = Object.fromEntries(fields.map(([key,,value]) => [key, value]));
const groups = [{...initial}];
const statusLine = document.querySelector('#status');
const importFile = document.querySelector('#catalog-import');
const importSubject = document.querySelector('#catalog-subject');
const importAdd = document.querySelector('#catalog-add');
const importStatus = document.querySelector('#import-status');
const commonTeacher = document.querySelector('#common-teacher');
const commonDate = document.querySelector('#common-date');
let importedCatalog = null;
commonTeacher.value = initial.teacher;
commonDate.value = initial.date;

function normalizePeriod(period) {
  return String(period || '').replace(/^([0-9]{4})[-/]([0-9]{4})$/, '$1/$2');
}
function applyCommon() {
  const teacher = commonTeacher.value.trim(), date = commonDate.value.trim();
  if (!teacher || !date) throw new Error('Заполните преподавателя и дату утверждения.');
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(date)) throw new Error('Дата утверждения: ДД.ММ.ГГГГ.');
  for (const row of groups) { row.teacher = teacher; row.date = date; }
  render();
  importStatus.textContent = 'Общие реквизиты применены к ' + groups.length + ' группам.';
}
document.querySelector('#common-apply').onclick = () => {
  try { applyCommon(); } catch (error) { importStatus.textContent = error.message; }
};
importFile.onchange = async () => {
  try {
    const selected = importFile.files?.[0];
    if (!selected) return;
    const document = JSON.parse(await selected.text());
    if (document.schemaVersion !== 1 || !Array.isArray(document.groups))
      throw new Error('Ожидается экспорт catalog-db.json версии 1 из дашборда БАРС.');
    const clean = document.groups.filter((row) =>
      typeof row.name === 'string' && typeof row.period === 'string' &&
      Array.isArray(row.disciplines));
    if (!clean.length) throw new Error('В каталоге нет групп с дисциплинами.');
    importedCatalog = clean;
    const names = [...new Set(clean.flatMap((row) =>
      row.disciplines.map((item) => item.name).filter((name) => typeof name === 'string')))]
      .sort((a,b) => a.localeCompare(b, 'ru'));
    importSubject.replaceChildren(new Option('Выберите дисциплину', ''),
      ...names.map((name) => new Option(name, name)));
    importAdd.disabled = false;
    importStatus.textContent = 'Импортировано групп: ' + clean.length +
      '; дисциплин: ' + names.length + '. Выберите дисциплину.';
  } catch (error) {
    importedCatalog = null;
    importAdd.disabled = true;
    importStatus.textContent = 'Ошибка импорта: ' + error.message;
  }
};
importAdd.onclick = () => {
  try {
    if (!importedCatalog || !importSubject.value) throw new Error('Выберите дисциплину из каталога.');
    const selected = importedCatalog.filter((row) =>
      row.disciplines.some((item) => item.name === importSubject.value));
    if (!selected.length) throw new Error('Нет групп с этой дисциплиной.');
    const existing = new Set(groups.map((row) =>
      JSON.stringify([row.group, row.subject, row.period])));
    let added = 0;
    for (const row of selected) {
      const normalizedPeriod = normalizePeriod(row.period);
      const identity = JSON.stringify([row.name, importSubject.value, normalizedPeriod]);
      if (existing.has(identity)) continue;
      const course = /[-–—]\s*(\d+)\s+курс$/i.exec(row.name)?.[1];
      groups.push({
        ...initial, teacher: commonTeacher.value.trim() || initial.teacher,
        date: commonDate.value.trim() || initial.date,
        group: row.name, period: normalizedPeriod, subject: importSubject.value,
        course: course || initial.course, autumn: '', spring: ''
      });
      existing.add(identity);
      added++;
    }
    render();
    importStatus.textContent = 'Добавлено столбцов: ' + added +
      '. Проверьте специальность, код и курс перед формированием XLS.';
  } catch (error) { importStatus.textContent = error.message; }
};
function title(group, semester) {
  const short = group.subject.replace(/^\S*\d\S*\s+/, '').replace(/\s+\([^()]*\)$/, '');
  return [semester + '-КТП', short, group.teacher, group.group].filter(Boolean).join(', ');
}
function render() {
  const heads = document.querySelector('#heads');
  while (heads.children.length > 1) heads.lastChild.remove();
  const body = document.querySelector('#fields');
  body.replaceChildren();
  groups.forEach((group, index) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = 'Группа ' + (index + 1);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remove';
    button.textContent = 'Удалить';
    button.disabled = groups.length === 1;
    button.onclick = () => { groups.splice(index, 1); render(); };
    th.append(button);
    heads.append(th);
  });
  for (const [key, label] of fields) {
    const tr = body.insertRow();
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = label;
    tr.append(th);
    groups.forEach((group, index) => {
      const input = document.createElement('input');
      input.value = group[key];
      input.maxLength = 250;
      input.dataset.key = key;
      input.dataset.index = index;
      input.required = !['autumn','spring','mdk','section'].includes(key);
      input.setAttribute('aria-label', label + ', группа ' + (index + 1));
      input.oninput = () => {
        group[key] = input.value;
        refreshTitles(index);
        updateCount();
      };
      tr.insertCell().append(input);
    });
  }
  groups.forEach((_, i) => refreshTitles(i));
  updateCount();
}
function refreshTitles(index) {
  ['autumn', 'spring'].forEach((key, semester) => {
    document.querySelector('[data-key="' + key + '"][data-index="' + index + '"]').placeholder = title(groups[index], semester + 1);
  });
}
function updateCount() {
  statusLine.textContent = 'Групп: ' + groups.length + ' · файлов XLS: ' + groups.length * 2;
}
document.querySelector('#add').onclick = () => {
  groups.push({...groups.at(-1), group: '', autumn: '', spring: ''});
  render();
  document.querySelector('[data-key="group"][data-index="' + (groups.length - 1) + '"]').focus();
};
document.querySelector('#editor').onsubmit = async event => {
  event.preventDefault();
  const download = document.querySelector('#download');
  download.disabled = true;
  try {
    const zip = new JSZip();
    groups.forEach((data, index) => {
      const g = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.trim()]));
      const safeGroup = g.group.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 90);
      if (fields.some(([key]) => !['mdk','section','autumn','spring'].includes(key) && !g[key]))
        throw Error('Заполните обязательные поля группы ' + (index + 1) + '.');
      ['autumn', 'spring'].forEach((key, i) => {
        const values = [g[key] || title(g, i + 1), g.period, g.specialty, g.code, g.group, g.course,
          g.subject, g.mdk, g.section, g.teacher, g.approval, g.date];
        const season = i === 0 ? 'Осень' : 'Весна';
        zip.file((index + 1) + '. ' + safeGroup + ' — ' + season + '.xls', buildWorkbook(templates[i], values));
      });
    });
    const url = URL.createObjectURL(await zip.generateAsync({type: 'blob', compression: 'DEFLATE'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'КТП по группам.zip';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    statusLine.textContent = 'Архив готов · файлов XLS: ' + Object.keys(zip.files).length;
  } catch (error) { statusLine.textContent = error.message; }
  finally { download.disabled = false; }
};
render();
