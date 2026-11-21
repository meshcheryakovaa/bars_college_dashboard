const groupPrefix = "catalog:group:";
const selectionPrefix = "catalog:selected:";

function groupKey(origin, period, label) {
  const name = label.trim().replace(/\s+/g, " ").replace(/\s[-–—]\s\d+\s+курс$/i, "");
  return JSON.stringify([origin, period, name]);
}

function catalogFromStorage(stored) {
  const groups = new Map();
  const selected = new Set();
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith(groupPrefix)) {
      const disciplines = new Map(value.disciplines.map((subject) => [subject.name, subject]));
      groups.set(key.slice(groupPrefix.length), {...value, disciplines, students: new Map()});
    }
    if (key.startsWith(selectionPrefix) && value) selected.add(key.slice(selectionPrefix.length));
  }

  // Earlier versions persisted only journals. Derive their group catalog as well.
  const unassigned = new Map();
  const journals = Object.entries(stored).filter(([key]) => key.startsWith("journal:"))
    .map(([, journal]) => journal).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  for (const journal of journals) {
    const {origin, period, group: name, subject} = journal;
    if (!name) {
      for (const student of journal.students) {
        unassigned.set(JSON.stringify([origin, period, student.id]), {
          id: student.id, name: student.name, origin, period
        });
      }
      continue;
    }
    const key = groupKey(origin, period, name);
    if (!groups.has(key)) groups.set(key, {key, origin, period, name, disciplines: new Map(), students: new Map()});
    const group = groups.get(key);
    if (!group.disciplines.has(subject)) group.disciplines.set(subject, {name: subject});
    for (const student of journal.students) group.students.set(student.id, {id: student.id, name: student.name});
  }
  return {groups, selected, unassigned};
}

function catalogDocument(stored) {
  const {groups, selected, unassigned} = catalogFromStorage(stored);
  return {
    schemaVersion: 1,
    unassignedStudents: [...unassigned.values()],
    groups: [...groups.values()].map((group) => ({
      key: group.key, origin: group.origin, period: group.period, name: group.name,
      selected: selected.has(group.key),
      disciplines: [...group.disciplines.values()],
      students: [...group.students.values()]
    }))
  };
}
