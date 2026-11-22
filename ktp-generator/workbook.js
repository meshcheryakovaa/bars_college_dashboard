// These two BIFF8 templates use a single contiguous Workbook stream,
// one FAT sector and one directory sector, with no mini streams.
function buildWorkbook(template, values) {
  const original = Uint8Array.from(atob(template), c => c.charCodeAt(0));
  const stream = original.slice(512, -1024);
  const view = new DataView(stream.buffer);
  const sheets = [];
  let sst, insertAt;
  for (let pos = 0; pos < stream.length;) {
    const type = view.getUint16(pos, true);
    if (type === 0x85) sheets.push(pos + 4);
    if (type === 0xfc) sst = pos + 4;
    if (type === 0x0a) { insertAt = pos; break; }
    pos += 4 + view.getUint16(pos + 2, true);
  }
  // Append complete strings after the existing SST continuation. Original
  // rich strings, worksheet records and validation rules stay intact.
  const strings = [...new Set(values)];
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
  const firstSheet = view.getUint32(sheets[0], true);
  for (let pos = firstSheet; view.getUint16(pos, true) !== 0x0a;) {
    if (view.getUint16(pos, true) === 0xfd && view.getUint16(pos + 6, true) === 1) {
      const row = view.getUint16(pos + 4, true);
      view.setUint32(pos + 10, firstIndex + strings.indexOf(values[row]), true);
    }
    pos += 4 + view.getUint16(pos + 2, true);
  }
  for (const p of sheets) view.setUint32(p, view.getUint32(p, true) + added.length, true);
  const length = stream.length + added.length;
  const sectors = Math.ceil(length / 512);
  const result = new Uint8Array((sectors + 3) * 512);
  const output = new DataView(result.buffer);
  result.set(original.subarray(0, 512));
  output.setUint32(48, sectors + 1, true);
  output.setUint32(76, sectors, true);
  result.set(stream.subarray(0, insertAt), 512);
  result.set(added, 512 + insertAt);
  result.set(stream.subarray(insertAt), 512 + insertAt + added.length);
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
