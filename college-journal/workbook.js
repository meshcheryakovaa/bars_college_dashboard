const spreadsheetType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const sheetType = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const mainNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function escapeXml(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>"']/g, (character) => (
      {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"}[character]
    ));
}

function worksheet(rows) {
  const body = rows.map((row, index) => {
    const line = index + 1;
    const cells = row.map((value, column) => {
      const ref = String.fromCharCode(65 + column) + line;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${line}">${cells}</row>`;
  }).join("");
  return `<worksheet xmlns="${mainNamespace}"><sheetViews><sheetView workbookViewId="0">
    <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
  </sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>
  <cols><col min="1" max="2" width="16" customWidth="1"/><col min="3" max="3" width="25" customWidth="1"/>
  <col min="4" max="4" width="42" customWidth="1"/><col min="5" max="8" width="22" customWidth="1"/></cols>
  <sheetData>${body}</sheetData></worksheet>`;
}

async function makeWorkbook(records) {
  const journals = [["Журнал", "Учебный период", "Группа (подсказка)", "Предмет", "Студентов", "Занятий", "Сайт", "Считано"]];
  const students = [["Журнал", "Учебный период", "Группа (подсказка)", "Предмет", "№ по списку", "ID студента", "Ф. И. О."]];
  const lessons = [["Журнал", "Учебный период", "Группа (подсказка)", "Предмет", "№ занятия", "Дата", "ID занятия"]];
  records.forEach((record, index) => {
    const context = [index + 1, record.period, record.group, record.subject];
    journals.push([...context, record.students.length, record.lessons.length, record.origin, record.savedAt]);
    for (const student of record.students) {
      students.push([...context, student.number, student.id, student.name]);
    }
    for (const lesson of record.lessons) {
      lessons.push([...context, lesson.number, lesson.date, lesson.id]);
    }
  });
  const sheets = [["Журналы", journals], ["Студенты", students], ["Занятия", lessons]];
  const zip = new JSZip();
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const xml = (path, value) => zip.file(path, declaration + value);

  xml("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="${spreadsheetType}.main+xml"/>
    ${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${sheetType}"/>`).join("")}
  </Types>`);

  const manifest = (entries) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`;
  xml("_rels/.rels", manifest(`<Relationship Id="rId1" Type="${relationNamespace}/officeDocument" Target="xl/workbook.xml"/>`));
  xml("xl/_rels/workbook.xml.rels", manifest(sheets.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="${relationNamespace}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("")));
  xml("xl/workbook.xml", `<workbook xmlns="${mainNamespace}" xmlns:r="${relationNamespace}"><sheets>
    ${sheets.map(([name], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}
  </sheets></workbook>`);
  sheets.forEach(([, rows], i) => xml(`xl/worksheets/sheet${i + 1}.xml`, worksheet(rows)));
  return zip.generateAsync({type: "blob", compression: "DEFLATE", mimeType: spreadsheetType});
}
