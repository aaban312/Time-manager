// enhancements.js (updated)
// - pomodoro button moved to bottom-left
// - cleanup to prevent stray "dot" anchors
// - custom Edit modal with datetime-local inputs (prefilled with task start/end)
// - does NOT modify core app files; uses window.__timeline API

(function(){
  'use strict';
  function log(...args){ console.log('[TS-enh]', ...args); }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
  function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function showToast(msg, timeout=3000){
    let t = document.getElementById('tsenh-toast');
    if(!t){
      t = document.createElement('div'); t.id='tsenh-toast';
      t.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:90px;background:#111;color:#fff;padding:8px 12px;border-radius:8px;z-index:2147483647;opacity:0.95;font-size:14px';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    clearTimeout(t._h);
    t._h = setTimeout(()=> t.textContent='', timeout);
  }

  // remove stray anchors or tiny elements that might be left behind (the "black dot" fix)
  function cleanupStrayIntentAnchors(){
    // remove anchors with intent:// href older than 1s (best-effort)
    const anchors = Array.from(document.querySelectorAll('a[href^="intent://"]'));
    anchors.forEach(a=>{
      try{
        // if display not none or zero-size, remove
        a.remove();
      }catch(e){}
    });
    // also remove any element we created earlier with known ids if any leftover
    ['tsenh-debug-anchor','tsenh-pomo','tsenh-toast','tsenh-edit-modal'].forEach(id=>{
      const el = document.getElementById(id);
      if(el && el.dataset && el.dataset._keep !== '1' && el.id !== 'tsenh-pomo') {
        // keep pomodoro element as intended; others safe to remove if orphaned
      }
    });
  }

  // format ms -> local ISO for datetime-local value (yyyy-MM-ddTHH:mm)
  function msToLocalInput(ms){
    if(!ms) return '';
    const d = new Date(ms);
    const YYYY = d.getFullYear();
    const MM = String(d.getMonth()+1).padStart(2,'0');
    const DD = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${YYYY}-${MM}-${DD}T${hh}:${mm}`;
  }

  // parse datetime-local back to ms (assumes local timezone)
  function inputToMs(v){
    if(!v) return null;
    // v format: "YYYY-MM-DDTHH:MM"
    const d = new Date(v);
    return d.getTime();
  }

  // extract task info from DOM node (best-effort mapping)
  function parseTaskElement(el){
    try{
      const titleEl = el.querySelector('.meta > div > div:first-child') || el.querySelector('.meta div');
      const timesEl = el.querySelector('.small.muted') || el.querySelector('.meta .small');
      const title = titleEl ? titleEl.textContent.replace(/\s*🔒\s*$/,'').trim() : null;
      const times = timesEl ? timesEl.textContent.trim() : null;
      return { title, times };
    }catch(e){
      return null;
    }
  }

  function findTaskByDom(el){
    if(!window.__timeline || !window.__timeline.loadTasks) return null;
    const parsed = parseTaskElement(el);
    if(!parsed || !parsed.title) return null;
    const tasks = window.__timeline.loadTasks();
    // exact match by title
    let candidates = tasks.filter(t=> t.title === parsed.title);
    if(candidates.length === 0){
      // partial match
      candidates = tasks.filter(t=> parsed.title && t.title && t.title.indexOf(parsed.title) !== -1);
    }
    if(candidates.length === 1) return candidates[0];
    // try match by times text
    if(parsed.times){
      for(const t of candidates){
        const s = formatDT(t.start) + ' — ' + formatDT(t.end);
        if(s === parsed.times) return t;
      }
    }
    return candidates[0] || null;
  }

  function formatDT(ms){
    if(!ms) return '-';
    const d = new Date(ms);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }

  // Build intent for native timer (ACTION_SET_TIMER)
  function buildSetTimerIntentUri(seconds, label){
    const encLabel = encodeURIComponent(label || 'Timer');
    const fallback = encodeURIComponent(location.href);
    // new: include package hint? (we keep generic)
    const intent = `intent://#Intent;action=android.intent.action.SET_TIMER;S.android.intent.extra.alarm.MESSAGE=${encLabel};i.android.intent.extra.alarm.LENGTH=${seconds};S.browser_fallback_url=${fallback};end`;
    return intent;
  }

  function openNativeTimer(seconds, label){
    if(!seconds || seconds <= 0){ showToast('Timer طول نامعتبر است'); return false; }
    cleanupStrayIntentAnchors(); // ensure no stray anchors remain
    const intent = buildSetTimerIntentUri(Math.round(seconds), label);
    try{
      const a = document.createElement('a');
      a.href = intent;
      a.style.display = 'none';
      a.rel = 'noopener';
      a.id = 'tsenh-debug-anchor';
      document.body.appendChild(a);
      a.click();
      // remove shortly after
      setTimeout(()=> { try { a.remove(); } catch(e){} }, 900);
      log('Tried intent', intent);
      return true;
    }catch(e){
      console.warn('openNativeTimer failed', e);
      return false;
    }
  }

  // --- Edit modal ---
  function createEditModal(){
    if(document.getElementById('tsenh-edit-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'tsenh-edit-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:2147483646';
    overlay.innerHTML = `
      <div style="background:#fff;padding:14px;border-radius:10px;min-width:300px;max-width:92%;box-shadow:0 10px 30px rgba(0,0,0,0.18)">
        <div style="font-weight:700;margin-bottom:8px">Edit task times</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label style="font-size:13px">Start
            <input id="tsenh-edit-start" type="datetime-local" style="width:100%;padding:8px;border:1px solid #e6e9f2;border-radius:6px" />
          </label>
          <label style="font-size:13px">End
            <input id="tsenh-edit-end" type="datetime-local" style="width:100%;padding:8px;border:1px solid #e6e9f2;border-radius:6px" />
          </label>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
          <button id="tsenh-edit-cancel" style="background:transparent;border:1px solid #e6e9f2;padding:8px;border-radius:6px">Cancel</button>
          <button id="tsenh-edit-save" style="background:#2563eb;color:#fff;border:none;padding:8px 12px;border-radius:6px">Save</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', function(e){
      if(e.target === overlay) closeEditModal();
    });
    document.body.appendChild(overlay);

    document.getElementById('tsenh-edit-cancel').addEventListener('click', closeEditModal);
  }

  function openEditModalForTask(task){
    if(!task) return;
    createEditModal();
    const overlay = document.getElementById('tsenh-edit-modal');
    overlay.style.display = 'flex';
    const sInput = document.getElementById('tsenh-edit-start');
    const eInput = document.getElementById('tsenh-edit-end');
    sInput.value = msToLocalInput(task.start);
    eInput.value = msToLocalInput(task.end);

    // remove previous handler to avoid duplicates
    const saveBtn = document.getElementById('tsenh-edit-save');
    const old = saveBtn._handler;
    if(old) saveBtn.removeEventListener('click', old);

    const handler = function(){
      const newS = inputToMs(sInput.value);
      const newE = inputToMs(eInput.value);
      if(!newS || !newE || newE <= newS){ alert('لطفاً تاریخ/ساعت معتبر وارد کن (End بعد از Start باشد)'); return; }
      // update task via timeline API (not modifying core DOM by direct changes)
      try{
        const tasks = window.__timeline.loadTasks();
        const idx = tasks.findIndex(x=> x.id === task.id);
        if(idx === -1){ alert('Task not found'); closeEditModal(); return; }
        tasks[idx].start = newS;
        tasks[idx].end = newE;
        window.__timeline.saveTasks(tasks);
        showToast('تاریخ/ساعت‌ها ذخیره شد');
      }catch(e){
        console.error('Failed to save edited task', e);
        alert('خطا در ذخیرهٔ تغییرات');
      }
      closeEditModal();
    };
    saveBtn._handler = handler;
    saveBtn.addEventListener('click', handler);
  }

  function closeEditModal(){
    const overlay = document.getElementById('tsenh-edit-modal');
    if(overlay) overlay.style.display = 'none';
  }

  // Attach interceptors to Start and Edit buttons for each .task element
  function attachToTask(taskEl){
    if(taskEl._tsenh_attached) return;
    taskEl._tsenh_attached = true;

    // ensure we don't propagate to original edit handler: use capture to stop propagation
    const buttons = Array.from(taskEl.querySelectorAll('button'));
    // Start
    const startBtn = buttons.find(b=> b.textContent && b.textContent.trim().toLowerCase()==='start');
    if(startBtn && !startBtn._tsenh){
      startBtn._tsenh = true;
      startBtn.addEventListener('click', function(evt){
        // do not prevent original start - we just attempt native timer afterwards
        setTimeout(()=> {
          try{
            const t = findTaskByDom(taskEl);
            if(!t){ log('could not map DOM to task for start'); return; }
            const now = Date.now();
            let seconds = 0;
            if(now < t.start) seconds = Math.round((t.end - t.start)/1000);
            else if(now >= t.start && now < t.end) seconds = Math.round((t.end - now)/1000);
            else { log('task already finished (start)'); return; }
            const ok = openNativeTimer(seconds, t.title || 'Timer');
            if(!ok) showToast('تلاش برای باز کردن تایمر نیتیو انجام نشد — تایمر درون‌صفحه ادامه دارد');
            else showToast('پیشنهاد باز شدن تایمر سیستمی ارسال شد — آن را تایید کن');
          }catch(e){ console.warn(e); }
        }, 140);
      }, {passive:true});
    }

    // Edit
    const editBtn = buttons.find(b=> b.textContent && b.textContent.trim().toLowerCase()==='edit');
    if(editBtn && !editBtn._tsenh){
      editBtn._tsenh = true;
      // add a capture listener to prevent original onclick (which used prompt) from executing
      editBtn.addEventListener('click', function(evt){
        try{
          // prevent original inline onclick from executing by stopping propagation to target/listeners
          evt.stopPropagation();
          evt.preventDefault();
        }catch(e){}
        // find task and open modal
        const t = findTaskByDom(taskEl);
        if(!t){ showToast('نشد تسک را پیدا کنم'); return; }
        openEditModalForTask(t);
      }, true); // capture: true -> runs in capture phase, prevents event reaching inline handler
    }
  }

  function attachStartInterceptors(){
    const observer = new MutationObserver(muts=>{
      muts.forEach(m=>{
        m.addedNodes && Array.from(m.addedNodes).forEach(n=>{
          if(n.nodeType===1 && n.matches && n.matches('.task')) attachToTask(n);
        });
      });
    });
    observer.observe(document.body, { childList:true, subtree:true });
    // attach to existing tasks
    document.querySelectorAll('.task').forEach(attachToTask);
  }

  // Pomodoro floating UI (bottom-left)
  function createPomodoroUI(){
    if(document.getElementById('tsenh-pomo')) return;
    const wrap = document.createElement('div');
    wrap.id = 'tsenh-pomo';
    wrap.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;font-family:system-ui';
    wrap.innerHTML = `
      <button id="tsenh-pomo-btn" title="Pomodoro" style="background:#10b981;color:white;border:none;padding:12px;border-radius:50%;box-shadow:0 6px 18px rgba(16,185,129,0.18);font-weight:700">🍅</button>
      <div id="tsenh-pomo-menu" style="display:none;position:fixed;left:16px;bottom:76px;background:#fff;border:1px solid #e6e9f2;padding:10px;border-radius:8px;box-shadow:0 6px 18px rgba(11,22,40,0.06);min-width:180px">
        <div style="margin-bottom:8px;font-weight:600">Quick timers</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="tsenh-preset" data-min="5" style="padding:6px 8px;border-radius:6px">5m</button>
          <button class="tsenh-preset" data-min="15" style="padding:6px 8px;border-radius:6px">15m</button>
          <button class="tsenh-preset" data-min="25" style="padding:6px 8px;border-radius:6px">25m</button>
          <button class="tsenh-preset" data-min="50" style="padding:6px 8px;border-radius:6px">50m</button>
        </div>
        <label style="display:block;margin-top:8px"><input type="checkbox" id="tsenh-create-task" checked /> Create task in timeline</label>
        <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">
          <button id="tsenh-close" style="background:transparent;border:1px solid #e6e9f2;padding:6px;border-radius:6px">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    const btn = document.getElementById('tsenh-pomo-btn');
    const menu = document.getElementById('tsenh-pomo-menu');
    btn.addEventListener('click', ()=> { menu.style.display = menu.style.display==='none' ? 'block' : 'none'; });
    document.getElementById('tsenh-close').addEventListener('click', ()=> menu.style.display='none');
    document.querySelectorAll('.tsenh-preset').forEach(b=>{
      b.addEventListener('click', async ()=>{
        const minutes = parseInt(b.dataset.min,10);
        const create = document.getElementById('tsenh-create-task').checked;
        const title = `Pomodoro — ${minutes}m`;
        const now = Date.now();
        const start = now;
        const end = now + minutes*60000;
        if(create && window.__timeline && window.__timeline.loadTasks && window.__timeline.saveTasks){
          try{
            const tasks = window.__timeline.loadTasks() || [];
            const newTask = { id: uid(), title, start, end, pinned:false };
            tasks.push(newTask);
            window.__timeline.saveTasks(tasks);
            showToast('Created Pomodoro task in timeline');
            await wait(150);
            // try to find created element and click its start
            const els = Array.from(document.querySelectorAll('.task'));
            for(const el of els){
              const p = parseTaskElement(el);
              if(!p) continue;
              if(p.title === title){
                const btns = Array.from(el.querySelectorAll('button'));
                const sbtn = btns.find(x=> x.textContent && x.textContent.trim().toLowerCase()==='start');
                if(sbtn){ sbtn.click(); }
                break;
              }
            }
          }catch(e){ console.warn('pomodoro create failed', e); }
        }else{
          const ok = openNativeTimer(minutes*60, title);
          if(ok) showToast('Opened native timer for Pomodoro');
        }
      });
    });
  }

  // init
  function init(){
    cleanupStrayIntentAnchors();
    attachStartInterceptors();
    createPomodoroUI();
    showToast('Enhancer loaded');
    // run a short cleanup after some seconds
    setTimeout(cleanupStrayIntentAnchors, 1200);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.__tsenh = { openNativeTimer, buildSetTimerIntentUri, msToLocalInput };

})();
