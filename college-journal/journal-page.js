(() => {
  if (window.collegeJournalPageBridge) return;
  window.collegeJournalPageBridge = true;

  const pending = new Map();
  let trackedConnection;
  function begin(connection, options) {
    pending.set(options, (pending.get(options) ?? 0) + 1);
  }
  function end(connection, response, options) {
    const count = pending.get(options) ?? 0;
    if (count <= 1) pending.delete(options);
    else pending.set(options, count - 1);
  }
  function track(connection) {
    if (connection === trackedConnection) return;
    trackedConnection = connection;
    connection.on("beforerequest", begin);
    connection.on("requestcomplete", end);
    connection.on("requestexception", end);
  }

  function widgetFor(ext, field) {
    if (!field) return null;
    const direct = ext.getCmp?.(field.id) ?? ext.ComponentMgr?.get?.(field.id);
    if (direct) return direct;
    let match;
    ext.ComponentMgr?.all?.each?.((component) => {
      if (component.el?.dom === field || component.getEl?.()?.dom === field) {
        match = component;
        return false;
      }
    });
    return match;
  }

  function normalizeDate(date) {
    if (typeof date === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
      const parts = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(date.trim());
      return parts ? [parts[3], parts[2].padStart(2, "0"), parts[1].padStart(2, "0")].join("-") : "";
    }
    if (!date || typeof date.getTime !== "function" || Number.isNaN(date.getTime())) return "";
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((part) => String(part).padStart(2, "0")).join("-");
  }

  function readDate({field, widget}) {
    return normalizeDate(field.value) || normalizeDate(widget?.getValue?.());
  }

  function writeDate({field, widget}, iso) {
    const text = iso.split("-").reverse().join(".");
    if (widget?.setValue) {
      try {
        widget.setValue(normalizeDate(widget.getValue?.()) && typeof widget.getValue?.() === "string" && !widget.format ? text : localDate(iso));
      } catch {
        widget.setValue(text);
      }
      if (readDate({field, widget}) !== iso) widget.setValue(text);
    }
    if (readDate({field, widget}) !== iso) {
      if (widget?.setRawValue) widget.setRawValue(text);
      else field.value = text;
    }
  }

  function localDate(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function command({action, fieldId, option}) {
    const ext = window.Ext;
    if (!ext?.Ajax?.on) throw new Error("Интерфейс журнала ещё не загрузился.");
    track(ext.Ajax);
    if (action === "ajax") return {busy: Boolean(pending.size || ext.Ajax.isLoading?.())};
    if (action === "activateWindow") {
      const widget = ext.getCmp?.(option.id) ?? ext.ComponentMgr?.get?.(option.id);
      widget?.toFront?.();
      return {};
    }
    if (action === "dateState" || action === "setDates") {
      const fields = option.fieldIds.map((id) => {
        const field = document.getElementById(id);
        if (!field) throw new Error("Не найдено поле даты журнала.");
        return {field, widget: widgetFor(ext, field)};
      });
      if (action === "setDates") {
        const changes = fields.map((entry, i) => ({...entry, old: readDate(entry), oldValue: entry.widget?.getValue?.() ?? entry.field.value, date: option.dates[i]}))
          .filter(({old, date}) => old !== date);
        for (const entry of changes) writeDate(entry, entry.date);
        if (fields.some((entry, i) => readDate(entry) !== option.dates[i])) {
          throw new Error("Поля журнала не приняли указанный диапазон.");
        }
        for (const {field, widget, oldValue, date} of changes) {
          const value = widget?.getValue?.() ?? field.value;
          widget?.fireEvent?.("change", widget, value, oldValue);
          widget?.fireEvent?.("select", widget, localDate(date));
          if (typeof field.dispatchEvent === "function") {
            field.dispatchEvent(new Event("input", {bubbles: true}));
            field.dispatchEvent(new Event("change", {bubbles: true}));
            field.dispatchEvent(new Event("blur"));
          }
        }
      }
      return {dates: fields.map(readDate)};
    }
    const field = document.getElementById(fieldId);
    const combo = widgetFor(ext, field);
    const store = combo?.getStore?.() ?? combo?.store;
    if (!field || !store?.getRange
      || typeof combo.onSelect !== "function" || typeof combo.onTriggerClick !== "function") {
      throw new Error("Не удалось определить выпадающий список по полю.");
    }

    const busy = Boolean(pending.size || ext.Ajax.isLoading?.() || store.loading === true || combo.loading === true);
    if (action === "state") {
      return {busy, value: String(combo.getValue() ?? "")};
    }

    if (action === "open") {
      if (!combo.isExpanded()) combo.onTriggerClick();
      return {};
    }
    if (action === "close") {
      combo.collapse();
      return {};
    }

    const records = store.getRange();
    const items = records.map((record) => {
      const label = String(record.get(combo.displayField) ?? "").replace(/\s+/g, " ").trim();
      const value = String(record.get(combo.valueField || combo.displayField) ?? "");
      return {label, value};
    });
    if (action === "list") {
      return {
        busy,
        expanded: combo.isExpanded(),
        listId: combo.innerList?.dom?.id,
        rendered: combo.view?.getNodes?.().length ?? null,
        total: store.getTotalCount?.() ?? items.length,
        items
      };
    }
    if (action === "select") {
      const index = items.findIndex(({value, label}) => value === option.value && label === option.label);
      if (index < 0 || busy) throw new Error("Выпадающий список изменился. Запустите сбор снова.");
      if (option.activateItem) combo.select?.(index, false);
      combo.onSelect(records[index], index);
      return {};
    }
    throw new Error("Неизвестное действие.");
  }

  document.addEventListener("college-journal-page-request", (event) => {
    const request = JSON.parse(event.detail);
    let response;
    try {
      response = {result: command(request)};
    } catch (error) {
      response = {error: error.message};
    }
    document.dispatchEvent(new CustomEvent("college-journal-page-response", {
      detail: JSON.stringify({id: request.id, ...response})
    }));
  });
})();
