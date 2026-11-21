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

  function dateFields(ext, fieldIds) {
    return fieldIds.map((id) => {
      const widget = ext.getCmp(id);
      if (!id || widget?.getEl?.()?.dom !== document.getElementById(id)
        || typeof widget?.getValue !== "function" || typeof widget.setValue !== "function"
        || typeof widget.fireEvent !== "function") {
        throw new Error("Не удалось найти поля дат журнала.");
      }
      return widget;
    });
  }

  function dateValue(widget) {
    const date = widget.getValue();
    if (typeof date === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
      const parts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
      return parts ? [parts[3], parts[2], parts[1]].join("-") : "";
    }
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((part) => String(part).padStart(2, "0")).join("-");
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
    if (action === "dateState" || action === "setDates") {
      const fields = dateFields(ext, option.fieldIds);
      if (action === "setDates") {
        const changes = fields.map((widget, i) => [widget, option.dates[i]])
          .filter(([widget, date]) => dateValue(widget) !== date);
        for (const [widget, date] of changes) widget.setValue(localDate(date));
        if (fields.some((widget, i) => dateValue(widget) !== option.dates[i] || widget.isValid?.() === false)) {
          throw new Error("Поля журнала не приняли указанный диапазон.");
        }
        for (const [widget, date] of changes) widget.fireEvent("select", widget, localDate(date));
      }
      return {dates: fields.map(dateValue)};
    }
    const field = document.getElementById(fieldId);
    const combo = ext.getCmp(fieldId);
    const store = combo?.getStore?.();
    if (!field || combo?.getEl?.()?.dom !== field || !store?.getRange
      || typeof combo.onSelect !== "function" || typeof combo.onTriggerClick !== "function") {
      throw new Error("Не удалось определить выпадающий список по полю.");
    }

    const busy = Boolean(pending.size || ext.Ajax.isLoading?.() || store.loading || combo.loading);
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
