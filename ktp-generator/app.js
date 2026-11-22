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
