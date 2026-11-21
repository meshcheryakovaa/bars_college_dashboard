const rangeKey = "dashboard:date-range";
const firstDay = "2026-09-01";

function todayIso() {
  const date = new Date();
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0")).join("-");
}

function dateRange(value) {
  return {from: value?.from || firstDay, to: value?.to || todayIso()};
}

function validRange(range) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return iso.test(range?.from) && iso.test(range?.to) && range.from <= range.to;
}
