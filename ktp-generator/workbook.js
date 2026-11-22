function approvalDateSerial(text) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (!match) throw Error('Введите дату утверждения в формате ДД.ММ.ГГГГ.');
  const [, day, month, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw Error('Проверьте дату утверждения: ' + text);
  }
  // Excel reserves serial 60 for the fictitious 29 February 1900.
  return (date - Date.UTC(1899, 11, 31)) / 86400000 + Number(date >= Date.UTC(1900, 2, 1));
}

// These two BIFF8 templates use a single contiguous Workbook stream,
// one FAT sector and one directory sector, with no mini streams.
function buildWorkbook(template, values) {
  const original = Uint8Array.from(atob(template), c => c.charCodeAt(0));
  const stream = original.slice(512, -1024);
  const view = new DataView(stream.buffer);
  const sheets = [];
  const formats = [];
  const serial = approvalDateSerial(values[11]);
  let sst, insertAt;
  for (let pos = 0; pos < stream.length;) {
    const type = view.getUint16(pos, true);
    if (type === 0x85) sheets.push(pos + 4);
    if (type === 0xe0) formats.push(pos);
    if (type === 0xfc) sst = pos + 4;
    if (type === 0x0a) { insertAt = pos; break; }
    pos += 4 + view.getUint16(pos + 2, true);
  }
  // Append complete strings after the existing SST continuation. Original
  // rich strings, worksheet records and validation rules stay intact.
  const strings = [...new Set(values.slice(0, 11))];
  const added = new Uint8Array(4 + strings.reduce((n, s) => n + 3 + s.length * 2, 0));
  const record = new DataView(added.buffer);
  if (added.length - 4 > 8224) throw Error('Суммарный объём текста превышает предел шаблона.');
  record.setUint16(0, 0x3c, true);
  record.setUint16(2, added.length - 4, true);
  let offset = 4;
  for (const s of strings) {
    record.setUint16(offset, s.length, true);
    added[offset + 2] = 1;
    offset += 3;
    for (let i = 0; i < s.length; i++, offset += 2) record.setUint16(offset, s.charCodeAt(i), true);
  }
  const firstIndex = view.getUint32(sst + 4, true);
  view.setUint32(sst + 4, firstIndex + strings.length, true);
  view.setUint32(sst, view.getUint32(sst, true) - 1, true);
  let dateFormat;
  const firstSheet = view.getUint32(sheets[0], true);
  for (let pos = firstSheet; view.getUint16(pos, true) !== 0x0a;) {
    if (view.getUint16(pos, true) === 0xfd && view.getUint16(pos + 6, true) === 1) {
      const row = view.getUint16(pos + 4, true);
      if (row === 11) {
        // A BIFF8 integer RK occupies the same space as a LABELSST.
        const base = formats[view.getUint16(pos + 8, true)];
        dateFormat = stream.slice(base, base + 24);
        new DataView(dateFormat.buffer).setUint16(6, 14, true); // Built-in short date
        dateFormat[13] |= 4; // Apply this XF's number format
        view.setUint16(pos, 0x027e, true);
        view.setUint16(pos + 8, formats.length, true);
        view.setUint32(pos + 10, serial * 4 + 2, true);
      } else {
        view.setUint32(pos + 10, firstIndex + strings.indexOf(values[row]), true);
      }
    }
    pos += 4 + view.getUint16(pos + 2, true);
  }
  const formatEnd = formats.at(-1) + dateFormat.length;
  const growth = dateFormat.length + added.length;
  for (const p of sheets) view.setUint32(p, view.getUint32(p, true) + growth, true);
  const length = stream.length + growth;
  const sectors = Math.ceil(length / 512);
  const result = new Uint8Array((sectors + 3) * 512);
  const output = new DataView(result.buffer);
  result.set(original.subarray(0, 512));
  output.setUint32(48, sectors + 1, true);
  output.setUint32(76, sectors, true);
  result.set(stream.subarray(0, formatEnd), 512);
  result.set(dateFormat, 512 + formatEnd);
  result.set(stream.subarray(formatEnd, insertAt), 512 + formatEnd + dateFormat.length);
  result.set(added, 512 + insertAt + dateFormat.length);
  result.set(stream.subarray(insertAt), 512 + insertAt + growth);
  const fat = (sectors + 1) * 512;
  result.fill(255, fat, fat + 512);
  for (let i = 0; i < sectors - 1; i++) output.setUint32(fat + i * 4, i + 1, true);
  output.setInt32(fat + (sectors - 1) * 4, -2, true);
  output.setInt32(fat + sectors * 4, -3, true);
  output.setInt32(fat + (sectors + 1) * 4, -2, true);
  const directory = fat + 512;
  result.set(original.subarray(-512), directory);
  output.setUint32(directory + 128 + 120, length, true);
  return result;
}
