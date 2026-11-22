(() => {
  if (globalThis.barsInspectorInstalled) return;
  globalThis.barsInspectorInstalled = true;
  const all = (root, css) => Array.from(root.querySelectorAll(css));
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const clean = value => String(value ?? '').replace(/\s+/g,' ').trim().slice(0,96);
  const known = /^(журнал(?: теоретических занятий| практических занятий)?|группа|предмет|с|по|применить|ок|отмена|сегодня|период обучения)$/i;
  function kind(label) {
    return clean(label).replace(/[:*]+$/,'').trim();
  }
  function state() {
    return {
      windows: all(document,'.x-window').filter(visible).slice(-6).map(win => {
        const title = clean(win.querySelector('.x-window-header-text')?.textContent);
        const fields = {};
        for (const input of all(win,'input').filter(visible)) {
          const label = kind(input.labels?.[0]?.textContent || input.closest('.x-form-item')?.querySelector('label')?.textContent);
          if (/^(с|по|группа|предмет)$/i.test(label)) fields[label] = clean(input.value);
        }
        const rows = selector => all(win,selector).filter(visible).map(grid => grid.querySelectorAll('.x-grid3-row').length);
        return {journal:title.match(/^Журнал (теоретических|практических) занятий/i)?.[0] || 'Другое окно',
          fields, leftRows:rows('.x-grid3-locked'), rightRows:rows('.x-grid3-unlocked'),
          tab:clean(win.querySelector('.x-tab-strip-active .x-tab-strip-text')?.textContent)};
      }),
      listSizes:all(document,'.x-combo-list-inner').filter(visible).map(el => el.querySelectorAll('.x-combo-list-item').length),
      loading:all(document,'.ext-el-mask,.ext-el-mask-msg').some(visible)
    };
  }
  function describe(el) {
    const control = el.closest('button,a,input,select,label,[role=button],.x-combo-list-item,.x-form-trigger,.x-grid3-cell,.x-tab-strip-text') || el;
    const label = kind(control.labels?.[0]?.textContent || control.textContent);
    return {tag:control.localName, classes:Array.from(control.classList).filter(c => /^(x-|ux-)/.test(c)).slice(0,6),
      label:known.test(label) ? label : undefined,
      position:control.parentElement ? Array.from(control.parentElement.children).indexOf(control)+1 : null};
  }
  let report, running = false, current, timer, writer, changes, resources, baseline;
  function persist() {
    clearTimeout(writer);
    chrome.runtime.sendMessage({type:'snapshot',report}).catch(() => {});
  }
  function scheduleSave() { clearTimeout(writer); writer = setTimeout(persist,100); }
  function sample() {
    if (!running) return;
    const target = current || report;
    const after = state();
    if (JSON.stringify(target.after) !== JSON.stringify(after)) {
      target.after = after;
      scheduleSave();
    }
  }
  function action(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    sample();
    if (report.steps.length >= 300) { end('Лимит 300 действий'); return; }
    current = {number:report.steps.length+1, event:event.type, ms:Math.round(performance.now()-baseline),
      element:describe(event.target), before:state(), requests:[], omittedRequests:0};
    current.after = current.before;
    report.steps.push(current);
    scheduleSave();
  }
  function network(entries) {
    for (const entry of entries) {
      if (entry.startTime < baseline || !['fetch','xmlhttprequest'].includes(entry.initiatorType)) continue;
      const ms = Math.round(entry.startTime-baseline);
      const target = report.steps.findLast(step => step.ms <= ms) || report;
      if (target.requests.length >= 30) { target.omittedRequests++; continue; }
      const url = new URL(entry.name,location.href);
      target.requests.push({ms, initiator:entry.initiatorType,
        path:url.origin === location.origin ? url.pathname.replace(/\d+/g,'#').slice(0,180) : '(другой сайт)',
        parameters:url.origin === location.origin ? Array.from(new Set(url.searchParams.keys())).slice(0,20).map(clean) : [],
        durationMs:Math.round(entry.duration), status:entry.responseStatus || null, bytes:entry.encodedBodySize});
    }
    scheduleSave();
  }
  const events = ['click','dblclick','change'];
  function begin() {
    if (running) return;
    baseline = performance.now();
    report = {version:1, started:new Date().toISOString(), site:location.origin,
      association:'Запрос отнесён к последнему действию перед его началом по времени браузера.',
      before:state(), requests:[], omittedRequests:0, steps:[]};
    current = null;
    running = true;
    for (const type of events) document.addEventListener(type,action,true);
    resources = new PerformanceObserver(list => network(list.getEntries()));
    resources.observe({entryTypes:['resource']});
    changes = new MutationObserver(() => {
      if (!timer) timer = setTimeout(() => { timer = null; sample(); },150);
    });
    changes.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
    persist();
  }
  function end(reason) {
    if (!running) return;
    network(resources.takeRecords());
    sample();
    running = false;
    resources.disconnect();
    changes.disconnect();
    clearTimeout(timer);
    timer = null;
    for (const type of events) document.removeEventListener(type,action,true);
    report.ended = new Date().toISOString();
    report.reason = reason;
    persist();
  }
  window.addEventListener('pagehide',() => end('Переход со страницы'));
  chrome.runtime.onMessage.addListener((message,sender,reply) => {
    if (!['start','stop','status'].includes(message.type)) return;
    if (message.type === 'start') begin();
    if (message.type === 'stop') end('Остановлено пользователем');
    if (message.type === 'status') sample();
    reply({running,report});
  });
})();
