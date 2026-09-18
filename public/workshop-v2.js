/* UI12 workflow contract. One controller, one modal, one mutation path. */
window.WorkshopV2 = (() => {
  'use strict';
  const base = '/api/workshop/v2';
  const state = { dialog: null, workflow: null, options: null, phaseId: '', mode: '', busy: false, dirty: false, sequence: 0, focus: null, reason: '', requestKey: '' };
  let dateSequence = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const tr = (en, hu) => typeof bi === 'function' ? bi(en, hu) : en;
  const hu = () => typeof currentLang !== 'undefined' && currentLang === 'hu';
  const actor = () => typeof user !== 'undefined' ? user : null;
  const isSuper = () => actor()?.role === 'SUPERADMIN' || Number(actor()?.is_superadmin) === 1;
  const isAdministrator = () => isSuper() || actor()?.role === 'ADMIN';

  const selected = value => value ? ' selected' : '';
  const checked = value => value ? ' checked' : '';
  const disabled = value => value ? ' disabled' : '';
  const button = (title, action, attributes = '') => `<button type="button" data-wf-action="${action}" ${attributes}>${esc(title)}</button>`;
  const field = (title, content) => `<label>${esc(title)}${content}</label>`;
  const input = (name, value = '', attributes = '') => `<input name="${name}" value="${esc(value)}" ${attributes}>`;
  const apiPath = (suffix = '') => `${base}/workflows/${encodeURIComponent(state.workflow.id)}${suffix}`;
  const phasePath = () => `/phases/${encodeURIComponent(state.phaseId)}`;
  const currentPhase = () => state.workflow?.stages?.find(phase => phase.id === state.phaseId);
  const userName = id => state.options?.users.find(item => item.id === id)?.name || id || '';
  const userOptions = value => {
    const users = [...(state.options?.users || [])];
    if (value && !users.some(item => item.id === value)) users.unshift({ id: value, name: userName(value) + tr(' (inactive)', ' (inakt\u00edv)') });
    return users.map(item => `<option value="${esc(item.id)}"${selected(item.id === value)}>${esc(item.name)}</option>`).join('');
  };
  const statusText = value => ({ ACTIVE: tr('Active', 'Akt\u00edv'), WAITING: tr('Waiting', 'V\u00e1rakozik'), IN_PROGRESS: tr('In progress', 'Folyamatban'), BLOCKED: tr('Blocked', 'Akad\u00e1lyozott'), COMPLETED: tr('Completed', 'K\u00e9sz'), ABORTED: tr('Abandoned', 'Megszak\u00edtva'), DELETED: tr('Deleted', 'T\u00f6r\u00f6lve'), OPEN: tr('Open', 'Nyitott') }[value] || value || '');
  const phaseName = phase => (hu() ? phase.name_snapshot_hu || phase.name_hu : phase.name_snapshot_en || phase.name_en) || phase.title || phase.stage_code;
  const formatMoney = cents => new Intl.NumberFormat(hu() ? 'hu-HU' : 'en-US', { style: 'currency', currency: 'USD' }).format(Number(cents || 0) / 100);
  const errors = {
    WORKFLOW_CANCELLATION_REASON_REQUIRED: ['A cancellation reason is required.', 'A megszak\u00edt\u00e1s indokl\u00e1sa k\u00f6telez\u0151.'],
    WORKFLOW_REVENUE_REVIEW_REQUIRED: ['Review the final revenue; enter zero when there is no customer charge.', 'Ellen\u0151rizd a v\u00e9gleges bev\u00e9telt; ha nincs d\u00edj, adj meg null\u00e1t.'],
    WORKFLOW_FINANCE_RESET_LOCKED: ['Financial test data were reset. This closed workflow cannot recreate them.', 'A p\u00e9nz\u00fcgyi tesztadatok t\u00f6r\u00f6lve. A lez\u00e1rt workflow nem hozhatja l\u00e9tre \u0151ket \u00fajra.'],
    WORKFLOW_FORBIDDEN: ['You do not have permission for this item.', 'Ehhez az elemhez nincs m\u00f3dos\u00edt\u00e1si jogosults\u00e1god.'],
    WORKFLOW_VERSION_CONFLICT: ['This workflow changed elsewhere. Reload before saving.', 'A workflow k\u00f6zben megv\u00e1ltozott. Ment\u00e9s el\u0151tt t\u00f6ltsd \u00fajra.'],
    WORKFLOW_TIME_INVALID: ['Choose a valid date and a 30-minute time slot.', 'V\u00e1lassz \u00e9rv\u00e9nyes d\u00e1tumot \u00e9s 30 perces id\u0151s\u00e1vot.'],
    WORKFLOW_TIME_DST_GAP: ['That New York time does not exist due to the clock change.', 'Ez a New York-i id\u0151pont az \u00f3ra\u00e1t\u00e1ll\u00edt\u00e1s miatt nem l\u00e9tezik.'],
    WORKFLOW_DATE_ORDER: ['The deadline cannot precede the start.', 'A hat\u00e1rid\u0151 nem el\u0151zheti meg a kezd\u00e9st.'],
    WORKFLOW_PHASE_OUTSIDE_DATES: ['The phase must stay within the workflow dates.', 'A f\u00e1zis hat\u00e1ridej\u00e9nek a workflow id\u0151hat\u00e1rain bel\u00fcl kell maradnia.'],
    WORKFLOW_TASK_OUTSIDE_DATES: ['The task must stay within its phase deadline.', 'A r\u00e9szfeladat nem l\u00e9pheti t\u00fal a f\u00e1zis hat\u00e1ridej\u00e9t.'],
    WORKFLOW_OVERRIDE_CONFIRMATION_REQUIRED: ['Confirm the administrative override.', 'Er\u0151s\u00edtsd meg az adminisztr\u00e1tori fel\u00fclb\u00edr\u00e1l\u00e1st.'],
    WORKFLOW_PHASE_INCOMPLETE: ['Complete the required tasks and checklist first.', 'El\u0151bb teljes\u00edtsd a k\u00f6telez\u0151 r\u00e9szfeladatokat \u00e9s ellen\u0151rz\u0151list\u00e1t.'],
    WORKFLOW_CHECKLIST_INCOMPLETE: ['Complete the required checklist first.', 'El\u0151bb teljes\u00edtsd a k\u00f6telez\u0151 ellen\u0151rz\u0151list\u00e1t.'],
    WORKFLOW_COST_APPROVAL_REQUIRED: ['The main responsible must approve the pending costs.', 'A f\u0151 felel\u0151snek j\u00f3v\u00e1 kell hagynia a f\u00fcgg\u0151 k\u00f6lts\u00e9geket.'],
    WORKFLOW_PHASE_FINANCE_CLOSED: ['These finances are closed. Posted costs cannot be edited.', 'Ez a p\u00e9nz\u00fcgyi r\u00e9sz lez\u00e1rt. A k\u00f6nyvelt k\u00f6lts\u00e9gek nem \u00edrhat\u00f3k \u00e1t.'],
    WORKFLOW_RELEASED_COST_REQUIRES_ADJUSTMENT: ['Completed financial postings require an accounting correction, not deletion.', 'A v\u00e9gleges k\u00f6nyvel\u00e9shez p\u00e9nz\u00fcgyi korrekci\u00f3 kell, nem t\u00f6rl\u00e9s.'],
    WORKFLOW_POSTED_COST_REQUIRES_ADJUSTMENT: ['Posted costs cannot be overwritten. Write off the original, then record a corrected cost.', 'A k\u00f6nyvelt k\u00f6lts\u00e9g nem \u00edrhat\u00f3 fel\u00fcl. El\u0151bb \u00edrd le, majd r\u00f6gz\u00edtsd a jav\u00edtott t\u00e9telt.'],
    WORKFLOW_CLOSED_PERIOD_REVIEW_REQUIRED: ['A closed financial period prevents this posting.', 'Lez\u00e1rt p\u00e9nz\u00fcgyi id\u0151szak miatt ez a k\u00f6nyvel\u00e9s nem hajthat\u00f3 v\u00e9gre.'],
    WORKFLOW_PIANO_CLIENT_MISMATCH: ['Select a piano linked to this client.', 'Az \u00fcgyf\u00e9lhez kapcsolt zongor\u00e1t v\u00e1laszd.'],
    WORKFLOW_ASSIGNEES_REQUIRED: ['Select at least one subresponsible.', 'V\u00e1lassz legal\u00e1bb egy alfelel\u0151st.'],
    WORKFLOW_CLOSED: ['This workflow is not active.', 'Ez a workflow nem akt\u00edv.'],
    PAYMENT_METHOD_REQUIRED: ['Select the customer invoice payment method.', 'V\u00e1laszd ki az \u00fcgyf\u00e9lsz\u00e1mla fizet\u00e9si m\u00f3dj\u00e1t.']
  };
  function errorMessage(error) {
    const code = error?.message || String(error);
    if (code === 'WORKFLOW_INCOMPLETE') {
      const info = error.details?.details || error.details || {};
      const items = [...(info.phases || []), ...(info.tasks || []), ...(info.checklist || []), ...(info.costs || [])];
      return tr('Required work or approvals are unfinished: ', 'K\u00f6telez\u0151 munka vagy j\u00f3v\u00e1hagy\u00e1s hi\u00e1nyzik: ') + items.map(item => item.title || item.id).join('; ');
    }
    const info=error.details?.details||error.details||{};
    return (errors[code] ? tr(...errors[code]) : code)+(info.title?' '+info.title:'')+(info.limit?' ('+info.limit.replace('T',' ')+')':'');
  }
  function failure(error) {
    const box = state.dialog?.open && state.dialog.querySelector('[data-wf-error]');
    if (box) { box.textContent = errorMessage(error); box.hidden = false; box.focus(); }
    else if (typeof showError === 'function') showError(errorMessage(error));
  }
  function ask(message, requestText = false) {
    return new Promise(resolve => {
      const box = document.createElement('dialog');
      box.className = 'wf2-dialog wf2-confirm';
      box.setAttribute('aria-label', tr('Confirmation', 'Meger\u0151s\u00edt\u00e9s'));
      box.innerHTML = `<main><p>${esc(message)}</p>${requestText ? field(tr('Reason', 'Indokl\u00e1s'), '<textarea data-answer rows="3" autofocus></textarea>') : ''}<div class="wf2-actions"><button type="button" data-cancel>${tr('Cancel', 'M\u00e9gse')}</button><button type="button" data-ok>${tr('Confirm', 'Meger\u0151s\u00edt\u00e9s')}</button></div></main>`;
      let finished = false;
      const finish = okay => { if (finished) return; finished = true; const result = requestText ? (okay ? box.querySelector('[data-answer]').value.trim() : null) : okay; box.close(); box.remove(); resolve(result); };
      box.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
      box.querySelector('[data-cancel]').onclick = () => finish(false);
      box.querySelector('[data-ok]').onclick = () => finish(true);
      document.body.append(box); box.showModal();
    });
  }
  async function adminReason() { return ''; }
  const reasonMarkup = () => '';
  function ensureDialog() {
    if (state.dialog) return state.dialog;
    const modal = document.createElement('dialog'); modal.id = 'workflow-v2-dialog'; modal.className = 'wf2-dialog';
    modal.setAttribute('aria-labelledby', 'wf2-title'); modal.setAttribute('data-ui-contract', 'UI12');
    modal.addEventListener('click', event => { void click(event).catch(failure); });
    modal.addEventListener('submit', event => { event.preventDefault(); void submit(event).catch(failure); });
    modal.addEventListener('input', event => { state.dirty=true;if(event.target.name==='service_address')event.target.dataset.manual='1'; });
    modal.addEventListener('change', event => { void change(event).catch(failure); });
    modal.addEventListener('cancel', event => { event.preventDefault(); void close(); });
    document.body.append(modal); state.dialog = modal; return modal;
  }
  function shell(title, content) {
    const modal = ensureDialog();
    modal.innerHTML = `<header class="wf2-header"><div><small>${tr('Workshop workflow \u00b7 UI12', 'M\u0171hely workflow \u00b7 UI12')}</small><h2 id="wf2-title">${esc(title)}</h2></div>${button('\u00d7', 'close', `class="wf2-close" aria-label="${esc(tr('Close', 'Bez\u00e1r\u00e1s'))}"`)}</header><div class="wf2-error" data-wf-error role="alert" tabindex="-1" hidden></div><main>${content}</main>`;
    if (!modal.open) { state.focus = document.activeElement; modal.showModal(); }
    modal.setAttribute('aria-busy', String(state.busy)); state.dirty = false; syncDateBounds();
  }
  async function close(force = false) {
    if (state.busy) return;
    if (!force && state.dirty && !await ask(tr('Discard unsaved changes?', 'Elveted a nem mentett m\u00f3dos\u00edt\u00e1sokat?'))) return;
    state.sequence++; state.dialog?.close(); state.workflow = null; state.mode = ''; state.dirty = false; state.focus?.focus?.();
  }
  async function mayNavigate() { return !state.busy && (!state.dirty || await ask(tr('Discard unsaved changes?', 'Elveted a nem mentett m\u00f3dos\u00edt\u00e1sokat?'))); }
  function setBusy(value) { state.busy = value; state.dialog?.setAttribute('aria-busy', String(value)); }

  // Date fields commit only explicit calendar/time choices. Merely opening a
  // legacy quarter-hour appointment does not round or overwrite its value.
  const nyDay = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function dateField(name, value, title, required = false, off = false) {
    const uid = `wf2-date-${++dateSequence}`;
    return `<div class="wf2-date" data-date-name="${name}"><label id="${uid}-label">${esc(title)}</label><input type="hidden" name="${name}" value="${esc(value || '')}"${required ? ' data-date-required="true"' : ''}><button type="button" class="wf2-date-toggle" data-date-action="toggle" aria-labelledby="${uid}-label ${uid}-value" aria-expanded="false"${disabled(off)}><span id="${uid}-value">${esc(value ? value.replace('T', ' ') : tr('Choose date and time', 'D\u00e1tum \u00e9s id\u0151 kiv\u00e1laszt\u00e1sa'))}</span><span aria-hidden="true"> \u25a6</span></button><div class="wf2-date-panel" hidden></div></div>`;
  }
  function dateRender(box, month) {
    const value = box.querySelector('input').value;
    let day = box.dataset.draftDay || value.slice(0,10) || nyDay();
    if(!value&&!box.dataset.draftDay){if(box.dataset.min&&day<box.dataset.min.slice(0,10))day=box.dataset.min.slice(0,10);if(box.dataset.max&&day>box.dataset.max.slice(0,10))day=box.dataset.max.slice(0,10);}
    const monthKey = month || box.dataset.month || day.slice(0, 7); box.dataset.month = monthKey;
    const [year, number] = monthKey.split('-').map(Number), first = new Date(Date.UTC(year, number - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7, count = new Date(Date.UTC(year, number, 0)).getUTCDate();
    let time = box.dataset.draftTime ?? (value.slice(11) || '09:00');
    const allowed=slot=>(!box.dataset.min||`${day}T${slot}`>=box.dataset.min)&&(!box.dataset.max||`${day}T${slot}`<=box.dataset.max);
    const aligned = /^\d{2}:(00|30)$/.test(time);
    const slots = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
    const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(hu() ? 'hu-HU' : 'en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, i + 1))));
    const days = '<span></span>'.repeat(offset) + Array.from({ length: count }, (_, i) => {
      const key = `${monthKey}-${String(i + 1).padStart(2, '0')}`;
      return `<button type="button" data-date-action="day" data-day="${key}"${disabled(Boolean((box.dataset.min&&key<box.dataset.min.slice(0,10))||(box.dataset.max&&key>box.dataset.max.slice(0,10))))} aria-pressed="${day === key}" class="${day === key ? 'selected' : ''}">${i + 1}</button>`;
    }).join('');
    box.querySelector('.wf2-date-panel').innerHTML = `<div class="wf2-month"><button type="button" data-date-action="previous" aria-label="${esc(tr('Previous month', 'El\u0151z\u0151 h\u00f3nap'))}">\u2039</button><strong>${esc(new Intl.DateTimeFormat(hu() ? 'hu-HU' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first))}</strong><button type="button" data-date-action="next" aria-label="${esc(tr('Next month', 'K\u00f6vetkez\u0151 h\u00f3nap'))}">\u203a</button></div><div class="wf2-days">${weekdays.map(item => `<small>${esc(item)}</small>`).join('')}${days}</div>${field(tr('Time \u00b7 New York \u00b7 30-minute slots', 'Id\u0151 \u00b7 New York \u00b7 30 perces id\u0151s\u00e1vok'), `<select data-native-select="true" data-date-time>${!aligned ? `<option value="" selected disabled>${esc(tr('Choose a new half-hour slot', 'V\u00e1lassz \u00faj f\u00e9l\u00f3r\u00e1s id\u0151s\u00e1vot'))}</option>` : ''}${slots.map(slot => `<option value="${slot}"${selected(slot === time)}${disabled(!allowed(slot))}>${slot}</option>`).join('')}</select>`)}${!aligned ? `<p class="wf2-note">${esc(tr('The saved legacy time is preserved until you select a new time.', 'A kor\u00e1bbi mentett id\u0151pont megmarad, am\u00edg \u00fajat nem v\u00e1lasztasz.'))}</p>` : ''}<div class="wf2-date-actions"><button type="button" data-date-action="today">${tr('Today', 'Ma')}</button>${!box.querySelector('input').dataset.dateRequired ? `<button type="button" data-date-action="clear">${tr('Clear', 'T\u00f6rl\u00e9s')}</button>` : ''}<button type="button" data-date-action="done">${tr('Done', 'K\u00e9sz')}</button></div>`;
  }
  function dateSet(box, value) {
    const hidden = box.querySelector('input'); if (hidden.value === value) return;
    if(value&&((box.dataset.min&&value<box.dataset.min)||(box.dataset.max&&value>box.dataset.max)))throw new Error(tr('The date must remain within the parent deadline: ','Az időpontnak a fölérendelt határidőn belül kell maradnia: ')+(box.dataset.min||'')+' - '+(box.dataset.max||''));
    box.dataset.inherited='0';
    hidden.value = value; box.querySelector('.wf2-date-toggle span').textContent = value ? value.replace('T', ' ') : tr('Choose date and time', 'D\u00e1tum \u00e9s id\u0151 kiv\u00e1laszt\u00e1sa');
    hidden.dispatchEvent(new Event('change', { bubbles: true })); syncDateBounds();
  }
  function dateClick(event) {
    const control = event.target.closest('[data-date-action]'); if (!control || control.disabled) return false;
    const box = control.closest('.wf2-date'), panel = box.querySelector('.wf2-date-panel'), action = control.dataset.dateAction;
    if (box.closest('fieldset')?.disabled) return true;
    event.preventDefault();
    if (action === 'toggle') { if (panel.hidden) dateRender(box); panel.hidden = !panel.hidden; box.querySelector('.wf2-date-toggle').setAttribute('aria-expanded', String(!panel.hidden)); return true; }
    if (action === 'previous' || action === 'next') {
      const [year, month] = box.dataset.month.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1 + (action === 'next' ? 1 : -1), 1));
      dateRender(box, date.toISOString().slice(0, 7)); return true;
    }
    if (action === 'clear') { delete box.dataset.draftDay; delete box.dataset.draftTime; dateSet(box, ''); }
    if (action === 'day' || action === 'today') {
      const requestedDay=action==='today'?nyDay():control.dataset.day;
      if((box.dataset.min&&requestedDay<box.dataset.min.slice(0,10))||(box.dataset.max&&requestedDay>box.dataset.max.slice(0,10)))return true;
      box.dataset.draftDay = action === 'today' ? nyDay() : control.dataset.day;
      let time = panel.querySelector('[data-date-time]').value;
      const candidate=`${box.dataset.draftDay}T${time}`;
      if(box.dataset.min&&candidate<box.dataset.min)time=box.dataset.min.slice(11);
      if(box.dataset.max&&candidate>box.dataset.max)time=box.dataset.max.slice(11);
      if (time) { box.dataset.draftTime = time; dateSet(box, `${box.dataset.draftDay}T${time}`); }
      dateRender(box, box.dataset.draftDay.slice(0, 7));
    }
    if (action === 'done' || action === 'clear') { panel.hidden = true; box.querySelector('.wf2-date-toggle').setAttribute('aria-expanded', 'false'); box.querySelector('.wf2-date-toggle').focus(); }
    return true;
  }
  function dateChange(event) {
    if (!event.target.matches('[data-date-time]')) return false;
    const box = event.target.closest('.wf2-date'); box.dataset.draftTime = event.target.value;
    box.dataset.draftDay ||= box.querySelector('input').value.slice(0, 10) || nyDay();
    dateSet(box, `${box.dataset.draftDay}T${box.dataset.draftTime}`); return true;
  }
  function mountDate(host, name, value) {
    host.innerHTML = dateField(name, value, tr('Date and time', 'D\u00e1tum \u00e9s id\u0151'), true);
    const box = host.querySelector('.wf2-date'); box.querySelector('input').id = name;
    host.onclick = dateClick; host.onchange = dateChange; dateRender(box); box.querySelector('.wf2-date-panel').hidden = false;
    box.querySelector('.wf2-date-toggle').setAttribute('aria-expanded', 'true');
  }
  function validateDates(form) {
    syncDateBounds();
    for(const box of form.querySelectorAll('.wf2-date')){const item=box.querySelector('input');if(item.matches(':disabled'))continue;
      if(item.dataset.dateRequired&&!item.value)throw new Error('WORKFLOW_TIME_INVALID');
      if(item.value&&((box.dataset.min&&item.value<box.dataset.min)||(box.dataset.max&&item.value>box.dataset.max)))throw new Error(box.querySelector('label').textContent+': '+tr('outside permitted dates ','kívül esik az engedélyezett időtartományon ')+(box.dataset.min||'')+' - '+(box.dataset.max||''));
    }
  }

  function pianoItems(clientId) {
    if (!clientId) return [];
    return (state.options?.pianos || []).filter(piano => piano.owner_contact_id === clientId || (!piano.owner_contact_id && state.options.client_pianos.some(link => link.client_id === clientId && link.piano_id === piano.id)));
  }
  function pianoLabel(piano) {
    return [piano.brand,piano.model].filter(Boolean).join(' \u2013 ') || piano.display_name || piano.id;
  }
  function updatePianoList(selectedId = '') {
    const form=state.dialog.querySelector('[data-wf-form=create]');if(!form)return;
    const clientId=form.querySelector('[name=client_id]')?.value||'',items=pianoItems(clientId),host=form.querySelector('[data-piano-list]');
    const chosen=items.some(p=>p.id===selectedId)?selectedId:items.length===1?items[0].id:'';
    host.innerHTML=`<input type="hidden" name="piano_id" value="${esc(chosen)}"><div class="wf2-piano-options" role="radiogroup" aria-label="${esc(tr('Choose piano','Zongora kiv\u00e1laszt\u00e1sa'))}">${items.map(p=>`<label class="wf2-piano-choice"><input type="radio" name="piano_choice" value="${esc(p.id)}"${checked(p.id===chosen)} required><span><strong>${esc(pianoLabel(p))}</strong><small>${esc([p.location_name,p.piano_location_address||p.location].filter(Boolean).join(' \u00b7 ')||tr('Location not recorded','Helysz\u00edn nincs r\u00f6gz\u00edtve'))}</small><small>${esc(p.serial_no?'#'+p.serial_no:tr('Serial not recorded','Gy\u00e1ri sz\u00e1m nincs r\u00f6gz\u00edtve'))} \u00b7 ${esc(p.id)}</small></span></label>`).join('')}</div>${!items.length&&clientId?`<p role="status">${esc(clientId?tr('This client has no piano recorded yet.','Ehhez az \u00fcgyf\u00e9lhez m\u00e9g nincs zongora r\u00f6gz\u00edtve.'):tr('Select a client to see their pianos.','V\u00e1lassz \u00fcgyfelet a zongor\u00e1i megjelen\u00edt\u00e9s\u00e9hez.'))}</p>`:''}`;
    form.querySelector('[data-wf-action=piano-existing]').disabled=!clientId;
    form.querySelector('[data-wf-action=piano-new]').textContent=clientId?tr('+ Add piano for this client','+ \u00daj zongora felvitele ehhez az \u00fcgyf\u00e9lhez'):tr('+ Add piano / client','+ \u00daj zongora / \u00fcgyf\u00e9l');
    updateServiceLocation();
  }
  function updateServiceLocation() {
    const form=state.dialog.querySelector('[data-wf-form=create]');if(!form)return;
    const onsite=form.querySelector('[name=mode]').value==='ON_SITE',box=form.querySelector('[data-service-address]'),address=box.querySelector('input');
    box.hidden=!onsite;address.disabled=!onsite;address.required=onsite;
    const p=(state.options.pianos||[]).find(p=>p.id===form.querySelector('[name=piano_id]')?.value);
    if(!address.dataset.manual)address.value=p?.piano_location_address||p?.location||'';
  }
  async function newPiano() {
    const form=state.dialog.querySelector('[data-wf-form=create]'),clientId=form.querySelector('[name=client_id]').value;
    const saved=await MasterData.open('pianos',null,{prefill:{owner_contact_id:clientId}});if(!saved||state.mode!=='create')return;
    // No shell re-render: all phase/task fields remain mounted, including disabled phases.
    const previous=state.options.pianos.findIndex(p=>p.id===saved.id);if(previous<0)state.options.pianos.push(saved);else state.options.pianos[previous]=saved;
    const clients=await api('/api/contacts',{masterCache:false});state.options.clients=clients;state.clientPicker.setItems(clients);
    state.clientPicker.set(clients.find(c=>c.id===saved.owner_contact_id));updatePianoList(saved.id);state.dirty=true;
  }
  async function existingPiano() {
    const form=state.dialog.querySelector('[data-wf-form=create]'),clientId=form.querySelector('[name=client_id]').value;
    if(!clientId)return;
    // Refresh from the registry. Already-owned records with a missing relation may be repaired.
    const fresh=await api(base+'/options');state.options.pianos=fresh.pianos;state.options.client_pianos=fresh.client_pianos;
    const items=pianoItems(clientId);if(!items.length){updatePianoList();return;}
    const chosen=await new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='wf2-dialog wf2-confirm';dialog.setAttribute('aria-label',tr('Existing piano','Meglev\u0151 zongora'));
      dialog.innerHTML=`<main><h3>${tr('Choose an existing piano for this client','V\u00e1lassz az \u00fcgyf\u00e9l meglev\u0151 zongor\u00e1i k\u00f6z\u00fcl')}</h3><form>${items.map(p=>`<label class="wf2-toggle"><input type="radio" name="existing" value="${esc(p.id)}" required><span>${esc(pianoLabel(p))}<small>${esc([p.serial_no,p.location_name,p.piano_location_address||p.location,p.id].filter(Boolean).join(' \u00b7 '))}</small></span></label>`).join('')}<div class="wf2-actions"><button type="submit">${tr('Select','Kiv\u00e1laszt\u00e1s')}</button><button type="button" data-cancel>${tr('Cancel','M\u00e9gse')}</button></div></form></main>`;
      const finish=value=>{dialog.close();dialog.remove();resolve(value);};dialog.querySelector('[data-cancel]').onclick=()=>finish(null);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
      dialog.querySelector('form').onsubmit=e=>{e.preventDefault();finish(new FormData(e.target).get('existing'));};document.body.append(dialog);dialog.showModal();
    });
    if(!chosen)return;
    await api(`/api/contacts/${encodeURIComponent(clientId)}/link-piano`,{method:'POST',body:JSON.stringify({piano_id:chosen})});
    updatePianoList(chosen);state.dirty=true;
  }
  function createPhaseMarkup(stage,due) {
    const code=stage.code,enabled=stage.enabled!==0;
    return `<fieldset class="wf2-create-phase" data-create-phase="${esc(code)}"${!enabled?' hidden disabled':''}><legend>${esc(hu()?stage.name_hu:stage.name_en)}</legend><div class="wf2-phase-plan-grid"><div class="wf2-grid">${field(tr('Phase responsible','F\u00e1zisfelel\u0151s'),`<select data-native-select="true" data-phase-responsible required>${userOptions(actor()?.id)}</select>`)}${dateField('phase_due_'+code,due,tr('Phase deadline','F\u00e1zis hat\u00e1rideje'),true)}<p class="wf2-note">${tr('Task deadlines cannot exceed this deadline.','A r\u00e9szfeladatok hat\u00e1rideje nem l\u00e9pheti t\u00fal ezt az id\u0151pontot.')}</p></div><div class="wf2-task-planner"><h4>${tr('Tasks and subresponsibles','R\u00e9szfeladatok \u00e9s alfelel\u0151s\u00f6k')}</h4>${field(tr('Suggested task','Javasolt r\u00e9szfeladat'),`<select data-native-select="true" data-task-template><option value="">${tr('Choose a suggestion...','V\u00e1lassz a javaslatokb\u00f3l...')}</option>${(state.options.task_catalog?.[code]||[]).map(t=>`<option value="${esc(t.id)}">${esc(hu()?t.name_hu:t.name_en)}</option>`).join('')}</select>`)}<div class="wf2-actions">${button(tr('+ Add selected task','+ Kiv\u00e1lasztott r\u00e9szfeladat'), 'plan-add-template')}${button(tr('+ Custom task','+ Egyedi r\u00e9szfeladat'), 'plan-add-custom')}</div><div data-plan-tasks></div><p class="wf2-cost-negative" data-phase-cost-total></p></div></div></fieldset>`;
  }
  function appendPlanTask(phase,template=null) {
    const container=phase.querySelector('[data-plan-tasks]');if(container.children.length>=200)throw new Error(tr('At most 200 tasks per phase.','F\u00e1zisonk\u00e9nt legfeljebb 200 r\u00e9szfeladat adhat\u00f3 meg.'));
    if(template&&[...container.children].some(row=>row.dataset.template===template.id))return;
    const row=document.createElement('article'),uid='plan-task-'+(++dateSequence);row.className='wf2-plan-task';row.dataset.template=template?.id||'';
    const responsible=phase.querySelector('[data-phase-responsible]').value,due=phase.querySelector('.wf2-date input').value;
    row.innerHTML=`<div class="wf2-plan-task-head">${field(tr('Task name','R\u00e9szfeladat neve'),input('task_title_'+uid,template?(hu()?template.name_hu:template.name_en):'','data-plan-title required maxlength="200"'))}${button(tr('Remove','Elt\u00e1vol\u00edt\u00e1s'),'plan-remove')}</div>${assigneesMarkup([responsible])}${dateField('task_due_'+uid,due,tr('Task deadline','R\u00e9szfeladat hat\u00e1rideje'),true)}${field(tr('Instructions (optional)','Utas\u00edt\u00e1sok (opcion\u00e1lis)'),'<textarea data-plan-description rows="2" maxlength="5000"></textarea>')}${planCostFields()}`;
    row.querySelector('.wf2-date').dataset.inherited='1';container.append(row);wizardRefreshTotals();
    if(template)phase.querySelector(`[data-task-template] option[value="${CSS.escape(template.id)}"]`).disabled=true;
    phase.querySelector('[data-task-template]').value='';syncDateBounds();state.dirty=true;row.querySelector('[data-plan-title]').focus();
  }
  function writeDate(box,value) {
    const hidden=box.querySelector('input');hidden.value=value||'';box.querySelector('.wf2-date-toggle span').textContent=value?value.replace('T',' '):tr('Choose date and time','D\u00e1tum \u00e9s id\u0151 kiv\u00e1laszt\u00e1sa');
  }
  function bounds(box,min,max) {if(box){box.dataset.min=min||'';box.dataset.max=max||'';}}
  function syncDateBounds() {
    const form=state.dialog?.querySelector('[data-wf-form=create]');
    if(form){
      const start=form.querySelector('[name=start_at]').value,final=form.querySelector('[name=final_due_at]').value;
      bounds(form.querySelector('[data-date-name=start_at]'),'',final);bounds(form.querySelector('[data-date-name=final_due_at]'),start,'');
      for(const phase of form.querySelectorAll('[data-create-phase]')){
        const phaseDate=phase.querySelector('.wf2-date');if(phaseDate.dataset.inherited==='1')writeDate(phaseDate,final);bounds(phaseDate,start,final);
        for(const task of phase.querySelectorAll('.wf2-plan-task')){const date=task.querySelector('.wf2-date');if(date.dataset.inherited==='1')writeDate(date,phaseDate.querySelector('input').value);bounds(date,start,phaseDate.querySelector('input').value||final);}
      }
      return;
    }
    const w=state.workflow;if(!w)return;
    const phase=currentPhase();
    for(const box of state.dialog.querySelectorAll('[data-wf-form=phase] .wf2-date'))bounds(box,w.start_at,w.final_due_at);
    for(const box of state.dialog.querySelectorAll('[data-wf-form=task] .wf2-date'))bounds(box,w.start_at,phase?.due_at||w.final_due_at);
    const schedule=state.dialog.querySelector('[data-wf-form=schedule]');if(!schedule)return;
    const start=schedule.querySelector('[name=start_at]')?.value||w.start_at,final=schedule.querySelector('[name=final_due_at]')?.value||w.final_due_at;
    for(const section of schedule.querySelectorAll('[data-schedule-phase]')){
      const p=w.stages.find(p=>p.id===section.dataset.schedulePhase),date=section.querySelector(':scope > .wf2-date');bounds(date,start,final);
      const due=date?.querySelector('input').value||p.due_at||final;
      for(const task of section.querySelectorAll('[data-schedule-task]'))bounds(task.querySelector('.wf2-date'),start,due);
    }
  }
  function scheduleMarkup(w) {
    if(w.status!=='ACTIVE'||w.historical)return '';
    const phases=w.stages.filter(p=>p.permissions.edit_phase||p.tasks.some(t=>t.permissions.edit_task));
    if(!w.permissions.edit_workflow&&!phases.length)return '';
    return `<details class="wf2-section"><summary>${tr('Edit coordinated schedule','\u00d6sszehangolt id\u0151terv m\u00f3dos\u00edt\u00e1sa')}</summary><p class="wf2-note">${tr('Dates are saved together. No task deadline is moved automatically.','Az id\u0151pontok egy\u00fctt ment\u0151dnek. Egyetlen r\u00e9szfeladat hat\u00e1rideje sem tol\u00f3dik el automatikusan.')}</p><form data-wf-form="schedule">${w.permissions.edit_workflow?dateField('start_at',w.start_at,tr('Workflow start','Workflow kezdete'),true):''}${w.permissions.edit_final_deadline?dateField('final_due_at',w.final_due_at,tr('Final deadline (Admin)','V\u00e9gs\u0151 hat\u00e1rid\u0151 (Admin)'),true):''}${phases.map(p=>`<fieldset data-schedule-phase="${esc(p.id)}"><legend>${esc(phaseName(p))}</legend>${p.permissions.edit_phase?dateField('schedule_phase_'+p.id,p.due_at||w.final_due_at,tr('Phase deadline','F\u00e1zis hat\u00e1rideje'),true):''}${p.tasks.filter(t=>t.permissions.edit_task).map(t=>`<div data-schedule-task="${esc(t.id)}">${dateField('schedule_task_'+t.id,t.due_at||p.due_at||w.final_due_at,t.title,true)}</div>`).join('')}</fieldset>`).join('')}<button type="submit">${tr('Save entire schedule','Teljes id\u0151terv ment\u00e9se')}</button></form></details>`;
  }
  function transferMarkup(name, value, off = false) {
    return `<div class="wf2-transfer"><div class="wf2-transfer-select">${field(tr('Responsible colleague', 'Felel\u0151s munkat\u00e1rs'), `<select data-native-select="true" name="${name}" data-responsible data-original="${esc(value)}"${disabled(off)}>${userOptions(value)}</select>`)}${!off ? button(tr('Handover', '\u00c1tad\u00e1s'), 'handover') : ''}</div><label data-transfer-reason hidden>${tr('Reason for handover', '\u00c1tad\u00e1s oka...')}<textarea name="transfer_reason" rows="2" maxlength="2000"></textarea></label></div>`;
  }
  function assigneesMarkup(values, off = false) {
    return `<fieldset class="wf2-assignees"${disabled(off)}><legend>${tr('Subresponsibles', 'Alfelel\u0151s\u00f6k')}</legend>${(state.options.users || []).map(person => `<label><input type="checkbox" name="assignee_ids" value="${esc(person.id)}"${checked(values.includes(person.id))}><span>${esc(person.name)}</span></label>`).join('')}</fieldset>`;
  }
  function wizardSteps() {
    const form=state.dialog.querySelector('[data-wf-form=create]');
    return ['basics', ...[...form.querySelectorAll('[data-create-phase]')].filter(p=>!p.disabled).map(p=>'phase:'+p.dataset.createPhase), 'finance', 'summary'];
  }
  function wizardTotals() {
    const form=state.dialog.querySelector('[data-wf-form=create]');
    let cents=0;
    for(const phase of form.querySelectorAll('[data-create-phase]:not(:disabled)')) for(const row of phase.querySelectorAll('.wf2-plan-task')) {
      if(row.querySelector('[data-plan-cost-enabled]')?.checked) cents+=Math.round(Number(row.querySelector('[data-plan-cost]').value||0)*100);
    }
    const raw=form.querySelector('[name=expected_revenue]').value;
    return {cost:cents,revenue:raw===''?null:Math.round(Number(raw)*100)};
  }
  function financialCards(revenue,planned,actual=null) {
    const cost=actual===null?planned:actual,profit=revenue===null?null:revenue-cost;
    return `<div class="wf2-financial-grid"><article><small>${tr('Expected revenue','V\u00e1rhat\u00f3 bev\u00e9tel')}</small><strong>${revenue===null?tr('Not specified','Nincs megadva'):esc(formatMoney(revenue))}</strong></article><article><small>${actual===null?tr('Planned costs','Tervezett k\u00f6lts\u00e9gek'):tr('Actual costs','T\u00e9nyleges k\u00f6lts\u00e9gek')}</small><strong class="wf2-cost-negative">${esc(formatMoney(-cost))}</strong></article><article><small>${tr('Expected result','V\u00e1rhat\u00f3 eredm\u00e9ny')}</small><strong class="${profit!==null&&profit<0?'wf2-cost-negative':'wf2-profit-positive'}">${profit===null?'\u2014':esc(formatMoney(profit))}</strong></article></div>`;
  }
  function wizardRefreshTotals() {
    if(state.mode!=='create')return;
    const form=state.dialog.querySelector('[data-wf-form=create]');if(!form)return;
    const totals=wizardTotals();
    for(const el of form.querySelectorAll('[data-plan-total]'))el.innerHTML=financialCards(totals.revenue,totals.cost);
    for(const phase of form.querySelectorAll('[data-create-phase]')) {
      let cost=0;for(const row of phase.querySelectorAll('.wf2-plan-task'))if(row.querySelector('[data-plan-cost-enabled]')?.checked)cost+=Math.round(Number(row.querySelector('[data-plan-cost]').value||0)*100);
      const box=phase.querySelector('[data-phase-cost-total]');if(box)box.textContent=tr('Phase planned costs: ','F\u00e1zis tervezett k\u00f6lts\u00e9ge: ')+formatMoney(-cost);
    }
  }
  function wizardSummary() {
    const form=state.dialog.querySelector('[data-wf-form=create]'),data=values(form);
    const piano=state.options.pianos.find(p=>p.id===data.piano_id),client=state.options.clients.find(c=>c.id===data.client_id);
    const edit=(step)=>button(tr('Edit','Szerkeszt\u00e9s'),'wizard-edit',`data-step="${esc(step)}"`);
    const pair=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${esc(value||'\u2014')}</dd></div>`;
    let html=`<article class="wf2-review-card"><header><h3>${tr('Workflow','Workflow')}</h3>${edit('basics')}</header><dl>${pair(tr('Title','Megnevez\u00e9s'),data.title)}${pair(tr('Main responsible','F\u0151 felel\u0151s'),userName(data.main_responsible_user_id))}${pair(tr('Client','\u00dcgyf\u00e9l'),client?.name)}${pair(tr('Piano','Zongora'),piano?pianoLabel(piano):'')}${pair(tr('Location','Helysz\u00edn'),data.mode==='ON_SITE'?data.service_address:[piano?.location_name,piano?.piano_location_address||piano?.location].filter(Boolean).join(' \u00b7 '))}${pair(tr('Start','Kezd\u00e9s'),data.start_at?.replace('T',' '))}${pair(tr('Final deadline','V\u00e9gs\u0151 hat\u00e1rid\u0151'),data.final_due_at?.replace('T',' '))}${pair(tr('Description','Le\u00edr\u00e1s'),data.description)}</dl></article>`;
    for(const phase of form.querySelectorAll('[data-create-phase]:not(:disabled)')) {
      const code=phase.dataset.createPhase,stage=state.options.stages.find(s=>s.code===code);
      html+=`<article class="wf2-review-card"><header><h3>${esc(hu()?stage.name_hu:stage.name_en)}</h3>${edit('phase:'+code)}</header><dl>${pair(tr('Responsible','Felel\u0151s'),userName(phase.querySelector('[data-phase-responsible]').value))}${pair(tr('Deadline','Hat\u00e1rid\u0151'),phase.querySelector('.wf2-date input').value.replace('T',' '))}</dl><div class="wf2-review-tasks">${[...phase.querySelectorAll('.wf2-plan-task')].map(row=>`<article><strong>${esc(row.querySelector('[data-plan-title]').value)}</strong><p>${esc([...row.querySelectorAll('[name=assignee_ids]:checked')].map(c=>userName(c.value)).join(', '))}</p><p>${esc(row.querySelector('.wf2-date input').value.replace('T',' '))}</p>${row.querySelector('[data-plan-cost-enabled]').checked?`<b class="wf2-cost-negative">${esc(formatMoney(-Math.round(Number(row.querySelector('[data-plan-cost]').value||0)*100)))}</b>`:''}</article>`).join('')}</div></article>`;
    }
    const totals=wizardTotals();
    html+=`<article class="wf2-review-card"><header><h3>${tr('Financial plan','P\u00e9nz\u00fcgyi terv')}</h3>${edit('finance')}</header>${financialCards(totals.revenue,totals.cost)}<p class="wf2-note">${tr('Internal plan only. Nothing is posted until final completion or a reasoned cancellation.','Csak bels\u0151 terv. A p\u00e9nz\u00fcgyi \u00e1tvezet\u00e9s a v\u00e9gleges lez\u00e1r\u00e1skor vagy indokolt megszak\u00edt\u00e1skor t\u00f6rt\u00e9nik.')}</p></article>`;
    form.querySelector('[data-wizard-summary]').innerHTML=html;
  }
  function wizardShow(step) {
    const form=state.dialog.querySelector('[data-wf-form=create]'),steps=wizardSteps();
    if(!steps.includes(step))step='basics';state.wizardStep=step;
    for(const panel of form.querySelectorAll('[data-wizard-step]'))panel.hidden=panel.dataset.wizardStep!==step;
    if(step==='summary')wizardSummary();wizardRefreshTotals();
    const index=steps.indexOf(step),phaseIndex=steps.filter(s=>s.startsWith('phase:')).indexOf(step);
    form.querySelector('[data-wizard-progress]').textContent=`${index+1} / ${steps.length} \u00b7 `+(step==='basics'?tr('Basic information','Alapadatok'):step==='finance'?tr('Financial plan','P\u00e9nz\u00fcgyi terv'):step==='summary'?tr('Review and start','\u00d6sszes\u00edt\u00e9s \u00e9s ind\u00edt\u00e1s'):tr('Selected phase ','Kiv\u00e1lasztott f\u00e1zis ')+(phaseIndex+1));
    form.querySelector('[data-wf-action=wizard-back]').hidden=index===0;
    const next=form.querySelector('[data-wf-action=wizard-next]');next.hidden=step==='summary';
    next.textContent=steps[index+1]==='finance'?tr('Continue to finances','Tov\u00e1bb a p\u00e9nz\u00fcgyekhez'):steps[index+1]==='summary'?tr('Review workflow','Workflow \u00f6sszes\u00edt\u00e9se'):tr('Next phase','K\u00f6vetkez\u0151 f\u00e1zis');
    if(step==='basics')next.textContent=tr('Continue to phases','Tov\u00e1bb a f\u00e1zisokhoz');
    form.querySelector('[data-wizard-submit]').hidden=step!=='summary';
    form.querySelector('[data-wf-action=wizard-return]').hidden=!state.wizardReturn||step==='summary';
    for(const panel of form.querySelectorAll('.wf2-date-panel'))panel.hidden=true;
    state.dialog.scrollTop=0;
    form.querySelector('[data-wizard-progress]').focus();
  }
  function wizardValidate(step=state.wizardStep) {
    const form=state.dialog.querySelector('[data-wf-form=create]'),panel=[...form.querySelectorAll('[data-wizard-step]')].find(p=>p.dataset.wizardStep===step);
    for(const control of panel.querySelectorAll('input,textarea,select'))if(!control.matches(':disabled')&&!control.checkValidity()) {wizardShow(step);control.reportValidity();return false;}
    if(step==='basics') {
      if(!form.querySelector('[name=client_id]').value)throw new Error(tr('Select a client.','V\u00e1lassz \u00fcgyfelet.'));
      if(!form.querySelector('[name=piano_id]').value)throw new Error(tr('Select a piano.','V\u00e1lassz zongor\u00e1t.'));
      if(wizardSteps().length===3)throw new Error(tr('Select at least one phase.','V\u00e1lassz legal\u00e1bb egy f\u00e1zist.'));
    }
    for(const row of panel.querySelectorAll('.wf2-plan-task'))if(!row.querySelector('[name=assignee_ids]:checked')){wizardShow(step);throw new Error('WORKFLOW_ASSIGNEES_REQUIRED');}
    validateDates(panel);return true;
  }
  function planCostFields(value=null,category='OTHER') {
    return `<label class="wf2-toggle"><input type="checkbox" data-plan-cost-enabled${checked(value!==null)}>${tr('Planned cost for this task','Tervezett k\u00f6lts\u00e9g ehhez a r\u00e9szfeladathoz')}</label><div class="wf2-grid" data-plan-cost-fields${value===null?' hidden':''}>${field(tr('Planned cost (USD)','Tervezett k\u00f6lts\u00e9g (USD)'),`<input type="number" inputmode="decimal" data-plan-cost min="0" max="100000000" step="0.01" value="${value===null?'':esc(value/100)}"${value===null?' disabled':' required'}>`)}${field(tr('Category','Kateg\u00f3ria'),`<select data-native-select="true" data-plan-cost-category${value===null?' disabled':''}>${[['MATERIAL',tr('Material','Anyag')],['TRANSPORT',tr('Transport','Sz\u00e1ll\u00edt\u00e1s')],['CONTRACTOR',tr('Subcontractor','Alv\u00e1llalkoz\u00f3')],['OTHER',tr('Other','Egy\u00e9b')]].map(([k,t])=>`<option value="${k}"${selected(k===category)}>${esc(t)}</option>`).join('')}</select>`)}</div>`;
  }
  async function create() {
    if(!await mayNavigate())return;
    const sequence=++state.sequence;state.reason='';state.mode='create';state.workflow=null;state.wizardStep='basics';state.wizardReturn=false;
    shell(tr('New workflow','\u00daj workflow'),`<p>${tr('Loading...','Bet\u00f6lt\u00e9s...')}</p>`);
    try {
      const options=await api(base+'/options');if(sequence!==state.sequence)return;state.options=options;
      state.requestKey=window.crypto?.randomUUID?.()||`create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const day=nyDay(),due=day+'T17:00';
      shell(tr('New workflow','\u00daj workflow'),`<form data-wf-form="create" novalidate class="wf2-wizard"><p class="wf2-wizard-progress" data-wizard-progress tabindex="-1" aria-live="polite"></p><section data-wizard-step="basics"><div class="wf2-grid wf2-basic-grid">${field(tr('Workflow title','Workflow megnevez\u00e9se'),input('title','','required maxlength="200"'))}${field(tr('Main responsible','F\u0151 felel\u0151s'),`<select data-native-select="true" name="main_responsible_user_id" required>${userOptions(actor()?.id)}</select>`)}<div data-client-picker></div><section class="wf2-piano-picker"><h3>${tr('Client piano','\u00dcgyf\u00e9l zongor\u00e1ja')}</h3><div data-piano-list></div><div class="wf2-actions">${button(tr('Existing piano','Meglev\u0151 zongora hozz\u00e1rendel\u00e9se'),'piano-existing')}${button(tr('+ Add piano / client','+ \u00daj zongora / \u00fcgyf\u00e9l'),'piano-new')}</div></section>${dateField('start_at',day+'T09:00',tr('Start \u00b7 New York','Kezd\u00e9s \u00b7 New York'),true)}${dateField('final_due_at',due,tr('Final deadline \u00b7 New York','V\u00e9gs\u0151 hat\u00e1rid\u0151 \u00b7 New York'),true)}${field(tr('Workflow type','Workflow t\u00edpusa'),`<select data-native-select="true" name="mode"><option value="INBOUND">${tr('In the workshop','M\u0171helyben')}</option><option value="ON_SITE">${tr('On site','Helysz\u00ednen')}</option></select>`)}${field(tr('Short description','R\u00f6vid le\u00edr\u00e1s'),'<textarea name="description" rows="2" maxlength="5000"></textarea>')}</div><div data-service-address hidden>${field(tr('Work location','Munkav\u00e9gz\u00e9s c\u00edme'),input('service_address','','maxlength="2000"'))}</div><section class="wf2-section"><h3>${tr('Select phases','F\u00e1zisok egyedi be\u00e1ll\u00edt\u00e1sa')}</h3><div class="wf2-phase-switches">${options.stages.map(stage=>`<label class="wf2-toggle"><input type="checkbox" data-phase-toggle="${esc(stage.code)}"${checked(stage.enabled!==0)}><span>${esc(hu()?stage.name_hu:stage.name_en)}</span></label>`).join('')}</div></section></section>${options.stages.map(stage=>`<section data-wizard-step="phase:${esc(stage.code)}" hidden>${createPhaseMarkup(stage,due)}</section>`).join('')}<section data-wizard-step="finance" hidden><h3>${tr('Financial plan','P\u00e9nz\u00fcgyi terv')}</h3>${field(tr('Expected workflow revenue (USD)','Workflow v\u00e1rhat\u00f3 bev\u00e9tele (USD)'),'<input name="expected_revenue" type="number" min="0" max="100000000" step="0.01" inputmode="decimal">')}<p class="wf2-note">${tr('Revenue can be revised while the workflow is active. Planned task costs are not posted.','A bev\u00e9tel akt\u00edv workflow eset\u00e9n m\u00f3dos\u00edthat\u00f3. A tervezett r\u00e9szfeladatk\u00f6lts\u00e9gek nem k\u00f6nyvel\u0151dnek.')}</p><div data-plan-total></div></section><section data-wizard-step="summary" data-wizard-summary hidden></section><footer class="wf2-wizard-nav">${button(tr('Back','Vissza'),'wizard-back')}${button(tr('Return to summary','Vissza az \u00f6sszes\u00edt\u00e9shez'),'wizard-return','hidden')}${button(tr('Next phase','K\u00f6vetkez\u0151 f\u00e1zis'),'wizard-next')}<button type="submit" data-wizard-submit hidden>${tr('Create and start workflow','Workflow l\u00e9trehoz\u00e1sa \u00e9s ind\u00edt\u00e1sa')}</button></footer></form>`);
      state.clientPicker=MasterData.clientPicker(state.dialog.querySelector('[data-client-picker]'),{items:options.clients,onSelect:()=>{const address=state.dialog.querySelector('[name=service_address]');if(address)delete address.dataset.manual;updatePianoList();state.dirty=true;}});
      for(const p of state.dialog.querySelectorAll('[data-create-phase]'))p.querySelector('.wf2-date').dataset.inherited='1';
      state.dialog.querySelector('[data-wf-form=create]').addEventListener('input',wizardRefreshTotals);
      updatePianoList();syncDateBounds();wizardShow('basics');state.dirty=false;
    }catch(error){failure(error);}
  }
  function callBadge(phone) {
    const dial = String(phone || '').replace(/[^+0-9*#,;]/g, '');
    return dial ? `<a class="wf2-call" href="tel:${esc(dial)}">${esc(phone)}</a>` : '';
  }
  function peopleHeader(w) {
    const owner = `<p><strong>${tr('Owner:', 'Tulajdonos:')}</strong> ${esc(w.owner_name || tr('Not recorded', 'Nincs r\u00f6gz\u00edtve'))} ${callBadge(w.owner_phone)}</p>`;
    const client = w.owner_is_client ? '' : `<p><strong>${tr('Client:', '\u00dcgyf\u00e9l:')}</strong> ${esc(w.client_name)} ${callBadge(w.client_phone)}</p>`;
    return `<section class="wf2-summary"><div data-owner-client>${owner}${client}<p><strong>${tr('Piano location:','Zongora helysz\u00edne:')}</strong> ${esc([w.piano_location_name,w.piano_location_address].filter(Boolean).join(' \u00b7 ')||tr('Not recorded','Nincs r\u00f6gz\u00edtve'))}</p>${w.mode==='ON_SITE'?`<p><strong>${tr('Work location:','Munkav\u00e9gz\u00e9s c\u00edme:')}</strong> ${esc(w.service_address||tr('Not recorded','Nincs r\u00f6gz\u00edtve'))}</p>`:''}</div><div><span class="wf2-status">${esc(statusText(w.status))}</span><p>${esc(w.title)}</p><small>${tr('Created by', 'L\u00e9trehoz\u00f3')}: ${esc(w.creator_name || w.creator_user_id)}<br>${tr('Main responsible', 'F\u0151 felel\u0151s')}: ${esc(w.main_responsible_name || userName(w.main_responsible_user_id))}</small></div></section>`;
  }
  function tasksMarkup(p) {
    const tasks = p.tasks || [], manager = p.permissions.edit_task_content;
    const total = tasks.length, done = tasks.filter(task => task.status === 'COMPLETED').length;
    return `<section class="wf2-section"><h3>${tr('Tasks', 'R\u00e9szfeladatok')}</h3><div class="wf2-progress" aria-live="polite"><progress value="${done}" max="${Math.max(1, total)}"></progress><strong>${done}/${total} ${tr('done', 'k\u00e9sz')}</strong></div>${tasks.map(task => {
      const complete = task.status === 'COMPLETED';
      const canReopen = p.permissions.reopen && state.workflow.status === 'ACTIVE';
      return `<article class="wf2-task" data-task="${esc(task.id)}"><div class="wf2-task-title"><label class="wf2-toggle"><input type="checkbox" data-task-complete="${esc(task.id)}"${checked(complete)}${disabled(complete ? !canReopen : !task.permissions.complete_task)}><strong>${esc(task.title)}</strong></label><span>${esc(statusText(task.status))}</span></div><p class="wf2-note">${esc((task.assignee_ids || []).map(userName).join(', '))}</p>${task.permissions.edit_task ? `<form data-wf-form="task" data-task-id="${esc(task.id)}">${task.permissions.edit_task_content ? field(tr('Title', 'Megnevez\u00e9s'), input('title', task.title, 'required maxlength="200"')) + assigneesMarkup(task.assignee_ids)+planCostFields(task.planned_cost_cents,task.planned_cost_category) : ''}${dateField('due_at', task.due_at, tr('Task deadline', 'R\u00e9szfeladat hat\u00e1rideje'))}<div class="wf2-actions"><button type="submit">${tr('Save task', 'R\u00e9szfeladat ment\u00e9se')}</button>${manager ? button(tr('Delete task', 'R\u00e9szfeladat t\u00f6rl\u00e9se'), 'task-delete', `data-id="${esc(task.id)}"`) : ''}</div></form>` : `<p>${esc(task.due_at?.replace('T', ' ') || '')}</p>${complete && canReopen ? button(tr('Reopen', '\u00dajranyit\u00e1s'), 'task-reopen', `data-id="${esc(task.id)}"`) : ''}`}</article>`;
    }).join('')}${manager ? `<details class="wf2-add"><summary>${tr('+ Add task', '+ R\u00e9szfeladat hozz\u00e1ad\u00e1sa')}</summary><form data-wf-form="task">${field(tr('Task title', 'R\u00e9szfeladat neve'), input('title', '', 'required maxlength="200"'))}${assigneesMarkup([p.responsible_user_id])}${planCostFields()}${dateField('due_at', p.due_at, tr('Task deadline', 'R\u00e9szfeladat hat\u00e1rideje'))}<button type="submit">${tr('Add task', 'R\u00e9szfeladat hozz\u00e1ad\u00e1sa')}</button></form></details>` : ''}</section>`;
  }
  function checklistMarkup(p) {
    const manager = p.permissions.edit_task_content;
    return `<section class="wf2-section"><h3>${tr('Checklist', 'Ellen\u0151rz\u0151lista')}</h3>${(p.checklist || []).map(item => {
      const task = p.tasks?.find(t => t.id === item.task_id);
      const canEdit = (manager || task?.permissions.complete_task) && (!item.checked || p.permissions.reopen) && task?.status !== 'COMPLETED';
      return `<div class="wf2-check"><label><input type="checkbox" data-check-id="${esc(item.id)}"${checked(item.checked)}${disabled(!canEdit)}><span>${esc(item.title)}${task ? ` <small>(${esc(task.title)})</small>` : ''}</span></label>${manager ? button(tr('Remove', 'T\u00f6rl\u00e9s'), 'check-delete', `data-id="${esc(item.id)}"`) : ''}</div>`;
    }).join('')}${manager ? `<form data-wf-form="checklist"><div class="wf2-grid">${field(tr('Checklist item', 'Listaelem'), input('title', '', 'required maxlength="200"'))}${field(tr('Related task (optional)', 'Kapcsol\u00f3d\u00f3 r\u00e9szfeladat (opcion\u00e1lis)'), `<select data-native-select="true" name="task_id"><option value="">${tr('Whole phase', 'Teljes f\u00e1zis')}</option>${(p.tasks || []).filter(t => t.status !== 'COMPLETED').map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('')}</select>`)}</div><button type="submit">${tr('+ Add checklist item', '+ Listaelem hozz\u00e1ad\u00e1sa')}</button></form>` : ''}</section>`;
  }
  function costForm(p,cost=null) {
    const cats=[['MATERIAL',tr('Material','Anyag')],['TRANSPORT',tr('Transport','Sz\u00e1ll\u00edt\u00e1s')],['CONTRACTOR',tr('Subcontractor','Alv\u00e1llalkoz\u00f3')],['OTHER',tr('Other','Egy\u00e9b')]];
    return `<form data-wf-form="cost"${cost?` data-cost-id="${esc(cost.id)}"`:''}><div class="wf2-grid">${field(tr('Actual cost (USD)','T\u00e9nyleges r\u00e1ford\u00edt\u00e1s (USD)'),`<input name="amount" type="number" inputmode="decimal" min="0.01" max="100000000" step="0.01" value="${cost?cost.amount_cents/100:''}" required>`)}${field(tr('Category','Kateg\u00f3ria'),`<select data-native-select="true" name="category">${cats.map(([id,label])=>`<option value="${id}"${selected((cost?.category||'OTHER')===id)}>${esc(label)}</option>`).join('')}</select>`)}${field(tr('Description','Megnevez\u00e9s'),input('title',cost?.title||'','maxlength="200"'))}${field(tr('Related task (optional)','Kapcsol\u00f3d\u00f3 r\u00e9szfeladat (opcion\u00e1lis)'),`<select data-native-select="true" name="task_id"><option value="">${tr('Whole phase','Teljes f\u00e1zis')}</option>${(p.tasks||[]).map(task=>`<option value="${esc(task.id)}"${selected(task.id===cost?.task_id)}>${esc(task.title)}</option>`).join('')}</select>`)}${field(tr('Supplier (optional)','Sz\u00e1ll\u00edt\u00f3 (opcion\u00e1lis)'),`<select data-native-select="true" name="partner_id"><option value="">${tr('Not specified','Nincs megadva')}</option>${(state.options.partners||[]).map(item=>`<option value="${esc(item.id)}"${selected(item.id===cost?.partner_id)}>${esc(item.company_name)}</option>`).join('')}</select>`)}${field(tr('Note (optional)','Megjegyz\u00e9s (opcion\u00e1lis)'),`<textarea name="note" rows="2" maxlength="2000">${esc(cost?.note||'')}</textarea>`)}</div><button type="submit">${cost?tr('Save cost','K\u00f6lts\u00e9g ment\u00e9se'):tr('+ Record actual cost','+ T\u00e9nyleges k\u00f6lts\u00e9g r\u00f6gz\u00edt\u00e9se')}</button></form>`;
  }
  function costsMarkup(p) {
    return `<section class="wf2-section"><h3>${tr('Actual phase costs','T\u00e9nyleges f\u00e1zisk\u00f6lts\u00e9gek')}</h3><p class="wf2-note">${tr('Internal records only until the entire workflow is completed or abandoned. Planned amounts are not posted as expenses.','A teljes workflow lez\u00e1r\u00e1s\u00e1ig vagy indokolt megszak\u00edt\u00e1s\u00e1ig csak bels\u0151 nyilv\u00e1ntart\u00e1s. A terv\u00f6sszegek nem k\u00f6nyvel\u0151dnek kiad\u00e1sk\u00e9nt.')}</p>${(p.costs||[]).map(cost=>`<article class="wf2-cost${cost.voided_at?' is-voided':''}"><div><strong>${esc(cost.title)}</strong><p class="wf2-cost-negative">\u2212${esc(formatMoney(cost.amount_cents))}</p><small>${cost.voided_at?tr('Removed','T\u00f6r\u00f6lve'):cost.approval_status==='PENDING'?tr('Awaiting main responsible approval','F\u0151 felel\u0151s j\u00f3v\u00e1hagy\u00e1s\u00e1ra v\u00e1r'):tr('Approved','J\u00f3v\u00e1hagyva')}</small>${cost.note?`<p>${esc(cost.note)}</p>`:''}${cost.finance_line_id?`<p>${tr('Transferred to finance','P\u00e9nz\u00fcgynek \u00e1tadva')}</p>`:''}</div><div class="wf2-actions">${!cost.voided_at&&cost.approval_status==='PENDING'&&p.permissions.approve_cost?button(tr('Approve','J\u00f3v\u00e1hagy\u00e1s'),'cost-approve',`data-id="${esc(cost.id)}"`):''}${!cost.voided_at&&!cost.finance_line_id&&p.permissions.record_cost&&p.permissions.approve_cost?button(tr('Remove cost','K\u00f6lts\u00e9g t\u00f6rl\u00e9se'),'cost-delete',`data-id="${esc(cost.id)}"`):''}</div>${!cost.voided_at&&!cost.finance_line_id&&p.permissions.record_cost?`<details><summary>${tr('Edit cost','K\u00f6lts\u00e9g szerkeszt\u00e9se')}</summary>${costForm(p,cost)}</details>`:''}</article>`).join('')}${p.permissions.record_cost?costForm(p):''}</section>`;
  }
  function financialMarkup(w) {
    const f=w.financial_summary;if(!f)return '';
    return `<section class="wf2-section wf2-financial-plan"><h3>${tr('Workflow financial tracking','Workflow p\u00e9nz\u00fcgyi nyomon k\u00f6vet\u00e9se')}</h3>${financialCards(f.expected_revenue_cents,f.planned_cost_cents,f.actual_cost_cents)}<p>${tr('Forecast cost (remaining plans and actual costs, without duplication)','V\u00e1rhat\u00f3 k\u00f6lts\u00e9g (h\u00e1tral\u00e9v\u0151 tervek \u00e9s t\u00e9nyleges k\u00f6lts\u00e9gek, dupl\u00e1z\u00e1s n\u00e9lk\u00fcl)')}: <strong class="wf2-cost-negative">\u2212${esc(formatMoney(f.forecast_cost_cents))}</strong></p><p>${tr('Forecast result','V\u00e1rhat\u00f3 eredm\u00e9ny')}: <strong>${f.expected_profit_cents==null?'\u2014':esc(formatMoney(f.expected_profit_cents))}</strong></p>${w.finance_reset?`<p>${tr('Financial records were reset. Automatic re-creation is disabled.','A p\u00e9nz\u00fcgyi adatok t\u00f6r\u00f6lve. Automatikus \u00fajral\u00e9trehoz\u00e1s letiltva.')}</p>`:w.permissions.edit_financial_plan?`<form data-wf-form="financial-plan">${field(tr('Expected workflow revenue (USD)','Workflow v\u00e1rhat\u00f3 bev\u00e9tele (USD)'),`<input name="expected_revenue" type="number" step="0.01" min="0" max="100000000" inputmode="decimal" value="${f.expected_revenue_cents==null?'':f.expected_revenue_cents/100}">`)}<button type="submit">${tr('Update expected revenue','V\u00e1rhat\u00f3 bev\u00e9tel m\u00f3dos\u00edt\u00e1sa')}</button></form>`:''}</section>`;
  }
  function documentsMarkup(p) {
    return `<section class="wf2-section"><h3>${tr('Documents', 'Dokumentumok')}</h3>${(p.documents || []).map(doc => `<div class="wf2-document"><span>${esc(doc.original_name)}</span>${button(tr('Open', 'Megnyit\u00e1s'), 'document-open', `data-id="${esc(doc.id)}"`)}${p.permissions.edit_phase ? button(tr('Remove', 'T\u00f6rl\u00e9s'), 'document-delete', `data-id="${esc(doc.id)}"`) : ''}</div>`).join('')}${p.permissions.edit_phase ? `<form data-wf-form="document">${field(tr('File (up to 20 MB)', 'F\u00e1jl (legfeljebb 20 MB)'), '<input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx" required>')}<button type="submit">${tr('Upload', 'Felt\u00f6lt\u00e9s')}</button></form>` : ''}</section>`;
  }
  function phaseMarkup(p) {
    const edit = p.permissions.edit_phase;
    return `<section class="wf2-phase" data-phase-id="${esc(p.id)}"><h3>${esc(phaseName(p))}</h3><form data-wf-form="phase"><fieldset${disabled(!edit)}><div class="wf2-grid">${field(tr('Phase title', 'F\u00e1zis neve'), input('title', p.title, 'required maxlength="200"'))}${dateField('due_at', p.due_at, tr('Phase deadline', 'F\u00e1zishat\u00e1rid\u0151'))}</div>${transferMarkup('responsible_user_id', p.responsible_user_id, !p.permissions.assign_phase)}${field(tr('Description', 'Le\u00edr\u00e1s'), `<textarea name="description" rows="2">${esc(p.description)}</textarea>`)}${field(tr('Phase status', 'F\u00e1zis \u00e1llapota'), `<select data-native-select="true" name="status">${['WAITING', 'IN_PROGRESS', 'BLOCKED', ...(p.status === 'COMPLETED' ? ['COMPLETED'] : [])].map(item => `<option value="${item}"${selected(p.status === item)}>${esc(statusText(item))}</option>`).join('')}</select>`)}${edit ? '<button type="submit">' + tr('Save phase', 'F\u00e1zis ment\u00e9se') + '</button>' : ''}</fieldset></form><div class="wf2-actions">${edit ? button(tr('Complete phase', 'F\u00e1zis lez\u00e1r\u00e1sa'), 'phase-close') : ''}${p.status === 'COMPLETED' && p.permissions.reopen && state.workflow.status === 'ACTIVE' ? button(tr('Reopen phase', 'F\u00e1zis \u00fajranyit\u00e1sa'), 'phase-reopen') : ''}${p.permissions.delete_phase ? button(tr('Remove phase', 'F\u00e1zis t\u00f6rl\u00e9se'), 'phase-delete', 'class="danger-btn"') : ''}</div>${tasksMarkup(p)}${checklistMarkup(p)}${costsMarkup(p)}${documentsMarkup(p)}</section>`;
  }
  function renderDetails() {
    const w = state.workflow; if (!w) return;
    if (!(w.stages || []).some(p => p.id === state.phaseId)) state.phaseId = w.stages?.[0]?.id || '';
    const p = currentPhase(), editable = w.permissions.edit_workflow;
    const missing = state.options.stages.filter(stage => !w.stages.some(phase => phase.stage_code === stage.code));
    const heading = [w.brand, w.model].filter(Boolean).join(' \u2013 ') || w.display_name || tr('Workflow details', 'Workflow r\u00e9szletei');
    const closeout = w.permissions.close_workflow ? `<section class="wf2-section wf2-closeout"><h3>${tr('Close the entire workflow', 'Teljes workflow lez\u00e1r\u00e1sa')}</h3><p>${tr('Only the main responsible or a system administrator may close the entire workflow.', 'A teljes workflow-t csak a f\u0151 felel\u0151s vagy rendszergazda z\u00e1rhatja le.')}</p><form data-wf-form="closeout">${!w.finance_locked?field(tr('Final reviewed revenue (USD)','V\u00e9gleges ellen\u0151rz\u00f6tt bev\u00e9tel (USD)'),`<input name="expected_revenue" type="number" step="0.01" min="0" max="100000000" value="${w.expected_revenue_cents==null?'':w.expected_revenue_cents/100}" required>`):''}${field(tr('Payment method (only for a billable customer invoice)', 'Fizet\u00e9si m\u00f3d (csak sz\u00e1ml\u00e1zhat\u00f3 \u00fcgyf\u00e9lsz\u00e1ml\u00e1hoz)'), `<select data-native-select="true" name="payment_method"><option value="">${tr('No invoice / select', 'Nincs sz\u00e1mla / v\u00e1lassz')}</option><option value="Bank Transfer / ACH">${tr('Bank transfer', 'Banki \u00e1tutal\u00e1s')}</option><option value="CASH">${tr('Cash', 'K\u00e9szp\u00e9nz')}</option><option value="CREDIT CARD">${tr('Card', 'Bankk\u00e1rtya')}</option><option value="CHECK">${tr('Check', 'Csekk')}</option></select>`)}${(isAdministrator() && !isSuper()) ? `<label class="wf2-toggle"><input name="override" type="checkbox">${tr('Override unfinished items and record each change in the audit.', 'Befejezetlen elemek fel\u00fclb\u00edr\u00e1l\u00e1sa, minden m\u00f3dos\u00edt\u00e1s audit\u00e1l\u00e1s\u00e1val.')}</label>` : ''}<button type="submit">${tr('Close workflow', 'Workflow lez\u00e1r\u00e1sa')}</button></form></section>` : '';
    shell(heading, `${peopleHeader(w)}${w.historical ? `<p class="wf2-note">${tr('Historical financial record. Read only.', 'T\u00f6rt\u00e9neti p\u00e9nz\u00fcgyi rekord. Csak olvashat\u00f3.')}</p>` : reasonMarkup()}${w.finance_locked && w.status === 'ACTIVE' ? `<p class="wf2-note">${tr('Operationally reopened. The existing invoice and financial close remain locked; no duplicate billing is permitted.', 'M\u0171k\u00f6d\u00e9sileg \u00fajranyitva. A kor\u00e1bbi sz\u00e1mla \u00e9s p\u00e9nz\u00fcgyi z\u00e1r\u00e1s v\u00e9dett; nincs ism\u00e9telt sz\u00e1ml\u00e1z\u00e1s.')}</p>` : ''}<details class="wf2-section" ${w.stages.length ? '' : 'open'}><summary>${tr('Workflow administration', 'Workflow adminisztr\u00e1ci\u00f3')}</summary><form data-wf-form="workflow"><fieldset${disabled(!editable)}>${field(tr('Workflow title', 'Workflow neve'), input('title', w.title, 'required maxlength="200"'))}${transferMarkup('main_responsible_user_id', w.main_responsible_user_id, !editable)}<div class="wf2-grid">${dateField('start_at', w.start_at, tr('Start \u00b7 New York', 'Kezd\u00e9s \u00b7 New York'), !w.historical)}${dateField('final_due_at', w.final_due_at, tr('Final deadline \u00b7 New York', 'V\u00e9gs\u0151 hat\u00e1rid\u0151 \u00b7 New York'), true, !w.permissions.edit_final_deadline)}</div>${field(tr('Description', 'Le\u00edr\u00e1s'), `<textarea name="description" rows="2">${esc(w.description)}</textarea>`)}${editable ? '<button type="submit">' + tr('Save workflow', 'Workflow ment\u00e9se') + '</button>' : ''}</fieldset></form></details><nav class="wf2-phase-nav" aria-label="${esc(tr('Phases', 'F\u00e1zisok'))}">${w.stages.map(phase => button(phaseName(phase), 'phase-select', `data-id="${esc(phase.id)}" aria-pressed="${phase.id === state.phaseId}"`)).join('')}</nav>${p ? phaseMarkup(p) : `<p>${tr('No active phases.', 'Nincs akt\u00edv f\u00e1zis.')}</p>`}${editable && !w.finance_locked && missing.length ? `<form data-wf-form="add-phase" class="wf2-section">${field(tr('Activate another phase', 'Tov\u00e1bbi f\u00e1zis aktiv\u00e1l\u00e1sa'), `<select data-native-select="true" name="stage_code">${missing.map(stage => `<option value="${esc(stage.code)}">${esc(hu() ? stage.name_hu : stage.name_en)}</option>`).join('')}</select>`)}<button type="submit">${tr('Activate phase', 'F\u00e1zis aktiv\u00e1l\u00e1sa')}</button></form>` : ''}${scheduleMarkup(w)}${financialMarkup(w)}${closeout}<div class="wf2-actions">${w.status === 'COMPLETED' && w.permissions.reopen ? button(tr('Reopen workflow', 'Workflow \u00fajranyit\u00e1sa'), 'workflow-reopen') : ''}${w.permissions.delete_workflow ? button(tr('Abandon workflow', 'Workflow megszak\u00edt\u00e1sa'), 'workflow-abort', 'class="danger-btn"') + button(tr('Delete workflow', 'Workflow t\u00f6rl\u00e9se'), 'workflow-delete', 'class="danger-btn"') : ''}${button(tr('Reload', '\u00dajrat\u00f6lt\u00e9s'), 'reload')}</div><details class="wf2-section"><summary>${tr('Audit trail', 'Auditnapl\u00f3')}</summary>${(w.audit || []).map(item => `<article class="wf2-audit"><strong>${esc(item.action)}</strong> \u00b7 ${esc(item.actor_name)}<br><small>${esc(item.created_at)} \u00b7 ${esc(item.entity_type)}</small><p>${esc(item.reason)}</p><details><summary>${tr('Recorded change', 'R\u00f6gz\u00edtett m\u00f3dos\u00edt\u00e1s')}</summary><pre>${esc(item.before_json || '')}\n\u2192\n${esc(item.after_json || '')}</pre></details></article>`).join('') || `<p>${tr('No mandatory business audit entries.', 'Nincs k\u00f6telez\u0151 \u00fczleti auditbejegyz\u00e9s.')}</p>`}</details>`);
  }
  async function open(id, phaseId = '') {
    if (!await mayNavigate()) return;
    const sequence = ++state.sequence; state.phaseId = phaseId; state.mode = 'details'; state.reason = '';
    shell(tr('Workflow details', 'Workflow r\u00e9szletei'), `<p>${tr('Loading...', 'Bet\u00f6lt\u00e9s...')}</p>`);
    try {
      const [workflow, options] = await Promise.all([api(`${base}/workflows/${encodeURIComponent(id)}`), api(base + '/options')]);
      if (sequence !== state.sequence) return; state.workflow = workflow; state.options = options;
      if (phaseId && !workflow.stages.some(phase => phase.id === phaseId)) state.phaseId = workflow.stages.find(phase => phase.tasks?.some(task => task.id === phaseId))?.id || '';
      renderDetails();
    } catch (error) { failure(error); }
  }
  function openCalendar(row) { return open(row.wf2_workflow_id || row.workflow_id, row.wf2_phase_id || (row.wf2_entity_type === 'PHASE' || row.wf2_entity_type === 'TASK' ? row.wf2_entity_id : '') || ''); }
  async function refreshViews() {
    // Refresh whichever real board/calendar is visible, plus user-scoped reminders.
    const tasks = [];
    if (typeof currentView !== 'undefined' && currentView === 'workshop_workflow' && typeof renderWorkshopWorkflow === 'function') tasks.push(renderWorkshopWorkflow());
    if (typeof currentView !== 'undefined' && currentView === 'scheduler' && typeof renderScheduler === 'function') tasks.push(renderScheduler());
    if (typeof currentView !== 'undefined' && currentView === 'today' && typeof renderToday === 'function') tasks.push(renderToday());
    if (typeof refreshDeadlineNotifications === 'function') tasks.push(refreshDeadlineNotifications({ renderMobile: typeof currentView !== 'undefined' && currentView === 'tasks' }));
    const results = await Promise.allSettled(tasks);
    for (const result of results) if (result.status === 'rejected') console.warn('Workflow view refresh:', result.reason);
    document.dispatchEvent(new CustomEvent('workflow-changed', { detail: { workflowId: state.workflow?.id || null } }));
  }
  async function mutate(path, method, payload = {}, formData = null) {
    if (state.busy) return null;
    const reason = await adminReason(); if (reason === null || state.busy) return null;
    if (reason) payload.reason = reason;
    if (state.workflow) payload.version = state.workflow.version;
    const sequence = state.sequence; setBusy(true);
    try {
      const request = { method };
      if (formData) { for (const [key, value] of Object.entries(payload)) formData.set(key, String(value)); request.body = formData; }
      else request.body = JSON.stringify(payload);
      const result = await api(path, request);
      if (sequence !== state.sequence) return result;
      if (result?.id && Array.isArray(result.stages)) { state.workflow = result; state.mode = 'details'; state.dirty = false; renderDetails(); }
      await refreshViews(); return result;
    } finally { if (sequence === state.sequence) setBusy(false); }
  }
  function values(form) { return Object.fromEntries(new FormData(form)); }
  async function submit(event) {
    const form = event.target.closest('[data-wf-form]'); if (!form || state.busy) return;
    const kind = form.dataset.wfForm;
    if(kind==='create'){for(const step of wizardSteps().filter(s=>s!=='summary')){try{if(!wizardValidate(step))return;}catch(error){wizardShow(step);throw error;}}}
    else {if(!form.reportValidity())return;validateDates(form);}
    const body = values(form);
    if (kind === 'create') {
      body.request_key = state.requestKey; body.mode = body.mode || 'INBOUND';
      if(!body.client_id)throw new Error(tr('Select a client.','V\u00e1lassz \u00fcgyfelet.'));
      if(!body.piano_id)throw new Error(tr('Select a piano for this workflow.','V\u00e1lassz zongor\u00e1t ehhez a workflow-hoz.'));
      body.phases=[...form.querySelectorAll('[data-create-phase]')].map(section=>({
        stage_code:section.dataset.createPhase,enabled:!section.disabled,responsible_user_id:section.querySelector('[data-phase-responsible]').value,
        due_at:section.querySelector('.wf2-date input').value,
        tasks:section.disabled?[]:[...section.querySelectorAll('.wf2-plan-task')].map(row=>{
          const assignee_ids=[...row.querySelectorAll('[name=assignee_ids]:checked')].map(c=>c.value);
          if(!assignee_ids.length)throw new Error('WORKFLOW_ASSIGNEES_REQUIRED');
          return {title:row.querySelector('[data-plan-title]').value.trim(),template_id:row.dataset.template||undefined,description:row.querySelector('[data-plan-description]').value,
            due_at:row.querySelector('.wf2-date input').value,assignee_ids,planned_cost:row.querySelector('[data-plan-cost-enabled]').checked?row.querySelector('[data-plan-cost]').value:null,planned_cost_category:row.querySelector('[data-plan-cost-category]').value};
        })
      }));
      for(const key of Object.keys(body))if(key.startsWith('phase_due_')||key.startsWith('task_')||['assignee_ids','piano_choice'].includes(key))delete body[key];
      await mutate(base + '/workflows', 'POST', body); return;
    }
    if (kind === 'settings') {
      const stages = [...form.querySelectorAll('[data-setting-code]')].map(section => ({ code: section.dataset.settingCode, name_en: section.querySelector('[name=name_en]').value.trim(), name_hu: section.querySelector('[name=name_hu]').value.trim(), sort_order: Number(section.querySelector('[name=sort_order]').value), color: section.querySelector('[name=color]').value, enabled: section.querySelector('[name=enabled]').checked, required: section.querySelector('[name=required]').checked, default_status: section.querySelector('[name=default_status]').value }));
      const result = await mutate(base + '/phases', 'PUT', { stages }); if (result) { state.dirty = false; await close(true); } return;
    }
    if(kind==='schedule'){
      const payload={phases:[],tasks:[]};
      if(body.start_at)payload.start_at=body.start_at;if(body.final_due_at)payload.final_due_at=body.final_due_at;
      for(const section of form.querySelectorAll('[data-schedule-phase]')){
        const date=section.querySelector(':scope > .wf2-date input');if(date)payload.phases.push({id:section.dataset.schedulePhase,due_at:date.value});
        for(const row of section.querySelectorAll('[data-schedule-task]'))payload.tasks.push({id:row.dataset.scheduleTask,due_at:row.querySelector('.wf2-date input').value});
      }
      await mutate(apiPath('/schedule'),'PUT',payload);return;
    }
    if(kind==='financial-plan'){await mutate(apiPath(),'PUT',{expected_revenue:body.expected_revenue});return;}
    if (kind === 'workflow') { await mutate(apiPath(), 'PUT', body); return; }
    if (kind === 'phase') { if (!currentPhase().permissions.assign_phase) delete body.responsible_user_id; await mutate(apiPath(phasePath()), 'PUT', body); return; }
    if (kind === 'task') {
      const task = currentPhase().tasks.find(item => item.id === form.dataset.taskId);
      const payload = { due_at: body.due_at || null };
      if (!task || task.permissions.edit_task_content) { payload.title = body.title; const costToggle=form.querySelector('[data-plan-cost-enabled]');if(costToggle){payload.planned_cost=costToggle.checked?form.querySelector('[data-plan-cost]').value:null;payload.planned_cost_category=form.querySelector('[data-plan-cost-category]').value;} payload.assignee_ids = new FormData(form).getAll('assignee_ids'); if (!payload.assignee_ids.length) throw new Error('WORKFLOW_ASSIGNEES_REQUIRED'); }
      await mutate(apiPath(phasePath() + '/tasks' + (task ? '/' + encodeURIComponent(task.id) : '')), task ? 'PUT' : 'POST', payload); return;
    }
    if (kind === 'cost') { body.amount = Number(body.amount); await mutate(apiPath(phasePath() + '/costs'+(form.dataset.costId?'/'+encodeURIComponent(form.dataset.costId):'')),form.dataset.costId?'PUT':'POST',body); return; }
    if (kind === 'checklist') { body.required = true; await mutate(apiPath(phasePath() + '/checklist'), 'POST', body); return; }
    if (kind === 'add-phase') { await mutate(apiPath('/phases/' + encodeURIComponent(body.stage_code) + '/create'), 'POST', {}); return; }
    if (kind === 'document') { await mutate(apiPath(phasePath() + '/documents'), 'POST', {}, new FormData(form)); return; }
    if (kind === 'closeout') {
      if (!await ask(tr('Close the entire workflow and finalize its financial postings?', 'Lez\u00e1rod a teljes workflow-t \u00e9s v\u00e9gleges\u00edted a p\u00e9nz\u00fcgyi k\u00f6nyvel\u00e9s\u00e9t?'))) return;
      body.override = Boolean(form.querySelector('[name=override]')?.checked); await mutate(apiPath('/close'), 'POST', body);
    }
  }
  async function change(event) {
    if (dateChange(event)) return;
    const target = event.target; state.dirty = true;
    if(target.matches('[data-plan-cost-enabled]')){const fields=target.closest('label').nextElementSibling;fields.hidden=!target.checked;for(const el of fields.querySelectorAll('input,select')){el.disabled=!target.checked;if(el.matches('input'))el.required=target.checked;}wizardRefreshTotals();return;}
    if (target.matches('[data-responsible]')) {
      const section = target.closest('.wf2-transfer'); section.querySelector('[data-transfer-reason]').hidden = target.value === target.dataset.original && section.dataset.forced !== '1'; return;
    }
    if(target.matches('[data-phase-toggle]')){
      const phase=state.dialog.querySelector(`[data-create-phase="${CSS.escape(target.dataset.phaseToggle)}"]`);phase.hidden=!target.checked;phase.disabled=!target.checked;syncDateBounds();wizardRefreshTotals();return;
    }
    const setDefaults=phase=>{for(const task of phase.querySelectorAll('.wf2-plan-task'))if(!task.dataset.manualAssignees)for(const checkbox of task.querySelectorAll('[name=assignee_ids]'))checkbox.checked=checkbox.value===phase.querySelector('[data-phase-responsible]').value;};
    if(target.matches('[data-phase-responsible]')){target.dataset.manual='1';setDefaults(target.closest('[data-create-phase]'));return;}
    if(target.name==='assignee_ids'&&target.closest('.wf2-plan-task')){target.closest('.wf2-plan-task').dataset.manualAssignees='1';return;}
    if(state.mode==='create'&&target.name==='main_responsible_user_id'){for(const select of state.dialog.querySelectorAll('[data-phase-responsible]'))if(!select.dataset.manual){select.value=target.value;setDefaults(select.closest('[data-create-phase]'));}return;}
    if(state.mode==='create'&&target.name==='mode'){updateServiceLocation();return;}
    if(state.mode==='create'&&target.name==='piano_choice'){target.form.querySelector('[name=piano_id]').value=target.value;const address=target.form.querySelector('[name=service_address]');delete address.dataset.manual;updateServiceLocation();return;}
    if (target.matches('[data-task-complete]')) {
      const task = currentPhase().tasks.find(item => item.id === target.dataset.taskComplete), wasComplete = task.status === 'COMPLETED';
      target.checked = wasComplete;
      if (wasComplete && !await ask(tr('Reopen this task?', '\u00dajranyitod ezt a r\u00e9szfeladatot?'))) return;
      await mutate(apiPath(phasePath() + '/tasks/' + encodeURIComponent(task.id) + (wasComplete ? '/reopen' : '/complete')), 'POST', {}); return;
    }
    if (target.matches('[data-check-id]')) {
      const value = target.checked; target.checked = !value;
      await mutate(apiPath(phasePath() + '/checklist/' + encodeURIComponent(target.dataset.checkId)), 'PUT', { checked: value });
    }
  }
  async function click(event) {
    if (dateClick(event)) return;
    const control = event.target.closest('[data-wf-action]'); if (!control || state.busy) return;
    const action = control.dataset.wfAction, key = encodeURIComponent(control.dataset.id || ''); event.preventDefault();
    if(action==='wizard-next'){if(wizardValidate()){const steps=wizardSteps();wizardShow(steps[steps.indexOf(state.wizardStep)+1]);}return;}
    if(action==='wizard-back'){const steps=wizardSteps();wizardShow(steps[steps.indexOf(state.wizardStep)-1]);return;}
    if(action==='wizard-edit'){state.wizardReturn=true;wizardShow(control.dataset.step);return;}
    if(action==='wizard-return'){if(wizardValidate()){state.wizardReturn=false;wizardShow('summary');}return;}
    if(action==='piano-new')return newPiano();
    if(action==='piano-existing')return existingPiano();
    if(action==='plan-add-custom'||action==='plan-add-template'){
      const phase=control.closest('[data-create-phase]'),id=phase.querySelector('[data-task-template]').value;
      const template=action==='plan-add-template'?(state.options.task_catalog?.[phase.dataset.createPhase]||[]).find(t=>t.id===id):null;
      if(action==='plan-add-template'&&!template)return;
      appendPlanTask(phase,template);return;
    }
    if(action==='plan-remove'){
      const row=control.closest('.wf2-plan-task'),phase=row.closest('[data-create-phase]');
      if(row.dataset.template)phase.querySelector(`[data-task-template] option[value="${CSS.escape(row.dataset.template)}"]`).disabled=false;
      row.remove();state.dirty=true;wizardRefreshTotals();return;
    }
    if (action === 'close') return close();
    if (action === 'handover') { const wrapper = control.closest('.wf2-transfer'); wrapper.dataset.forced = '1'; wrapper.querySelector('[data-transfer-reason]').hidden = false; wrapper.querySelector('textarea').focus(); return; }
    if (action === 'phase-select') { if (!await mayNavigate()) return; state.reason = state.dialog.querySelector('[data-admin-reason]')?.value || state.reason; state.phaseId = control.dataset.id; renderDetails(); return; }
    if (action === 'reload') return open(state.workflow.id, state.phaseId);
    if (action === 'document-open') return downloadDocument(control.dataset.id);
    const loss = ['phase-delete','cost-delete','workflow-abort','workflow-delete'].includes(action);
    let abortReason='';
    if(['workflow-abort','workflow-delete'].includes(action)){
      const answer=await ask(tr('Permanently stop this workflow? Actual costs will be transferred to finance. Enter the mandatory cancellation reason.','V\u00e9glegesen megszak\u00edtod a workflow-t? A t\u00e9nyleges k\u00f6lts\u00e9gek \u00e1tker\u00fclnek a p\u00e9nz\u00fcgybe. Add meg a k\u00f6telez\u0151 indokl\u00e1st.'),true);
      if(answer===null)return;if(!answer)throw new Error(tr('A cancellation reason is required.','A megszak\u00edt\u00e1s indokl\u00e1sa k\u00f6telez\u0151.'));abortReason=answer;
    }else if(loss&&!await ask(tr('Confirm removal? Existing actual costs on a removed phase are retained for final settlement.','Meger\u0151s\u00edted a t\u00f6rl\u00e9st? A t\u00f6r\u00f6lt f\u00e1zis t\u00e9nyleges k\u00f6lts\u00e9gei a v\u00e9gleges elsz\u00e1mol\u00e1sig megmaradnak.')))return;
    if (!loss && ['task-delete', 'check-delete', 'document-delete', 'phase-close', 'phase-reopen', 'task-reopen', 'workflow-reopen'].includes(action) && !await ask(tr('Confirm this workflow action?', 'Meger\u0151s\u00edted ezt a workflow m\u0171veletet?'))) return;
    const actions = {
      'phase-close': [phasePath() + '/close', 'POST'], 'phase-reopen': [phasePath() + '/reopen', 'POST'], 'phase-delete': [phasePath(), 'DELETE'],
      'task-delete': [phasePath() + '/tasks/' + key, 'DELETE'], 'task-reopen': [phasePath() + '/tasks/' + key + '/reopen', 'POST'],
      'check-delete': [phasePath() + '/checklist/' + key, 'DELETE'], 'cost-delete': [phasePath() + '/costs/' + key, 'DELETE'], 'cost-approve': [phasePath() + '/costs/' + key + '/approve', 'POST'],
      'document-delete': [phasePath() + '/documents/' + key, 'DELETE'], 'workflow-abort': ['/abort', 'POST'], 'workflow-delete': ['', 'DELETE'], 'workflow-reopen': ['/reopen', 'POST']
    };
    const item = actions[action]; if (!item) return;
    const payload = loss ? { confirmed: true, ...(abortReason?{reason:abortReason}:{}) } : {};
    const result = await mutate(apiPath(item[0]), item[1], payload);
    if (result && action === 'workflow-delete') { state.dirty = false; await close(true); }
  }
  async function downloadDocument(id) {
    const doc = currentPhase()?.documents.find(item => item.id === id);
    const response = await fetch(`${base}/documents/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${typeof token !== 'undefined' ? token : ''}` } });
    if (!response.ok) throw new Error(tr('Document could not be opened.', 'A dokumentum nem nyithat\u00f3 meg.'));
    const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a'); anchor.href = url; anchor.download = doc?.original_name || 'document'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function settings() {
    if (!isAdministrator() || !await mayNavigate()) return;
    const sequence = ++state.sequence; state.mode = 'settings'; state.workflow = null; state.reason = '';
    shell(tr('Phase settings', 'F\u00e1zisbe\u00e1ll\u00edt\u00e1sok'), `<p>${tr('Loading...', 'Bet\u00f6lt\u00e9s...')}</p>`);
    try {
      const options = await api(base + '/options'); if (sequence !== state.sequence) return; state.options = options;
      shell(tr('Seven phase definitions', 'H\u00e9t alapf\u00e1zis'), `${reasonMarkup()}<form data-wf-form="settings">${options.stages.map(stage => `<fieldset data-setting-code="${esc(stage.code)}"><legend>${esc(stage.code)}</legend><div class="wf2-grid">${field('English', input('name_en', stage.name_en, 'required maxlength="200"'))}${field('Magyar', input('name_hu', stage.name_hu, 'required maxlength="200"'))}${field(tr('Order (0\u20136)', 'Sorrend (0\u20136)'), input('sort_order', stage.sort_order, 'type="number" min="0" max="6" step="1" required'))}${field(tr('Color', 'Sz\u00edn'), input('color', stage.color, 'type="color"'))}${field(tr('Default status', 'Alap\u00e9rtelmezett \u00e1llapot'), `<select data-native-select="true" name="default_status">${['WAITING', 'IN_PROGRESS', 'BLOCKED'].map(value => `<option value="${value}"${selected(stage.default_status === value)}>${esc(statusText(value))}</option>`).join('')}</select>`)}</div><label class="wf2-toggle"><input type="checkbox" name="enabled"${checked(stage.enabled)}> ${tr('Active by default', 'Alap\u00e9rtelmezetten akt\u00edv')}</label><label class="wf2-toggle"><input type="checkbox" name="required"${checked(stage.required)}> ${tr('Required when active', 'Aktiv\u00e1lva k\u00f6telez\u0151')}</label></fieldset>`).join('')}<button type="submit">${tr('Save phase settings', 'F\u00e1zisbe\u00e1ll\u00edt\u00e1sok ment\u00e9se')}</button></form>`);
    } catch (error) { failure(error); }
  }
  async function purge(id = null) {
    if (!isSuper()) return;
    if (id) { await open(id); if (state.workflow?.id !== id) return; if (!state.workflow.permissions.delete_workflow) return failure(new Error('WORKFLOW_RELEASED_COST_REQUIRES_ADJUSTMENT')); }
    const reason = await ask(tr('Permanently stop these workflows and settle their actual costs? Enter the required cancellation reason.','Végleg megszakítod ezeket a workflow-kat és elszámolod a tényleges költségeket? Add meg a kötelező indoklást.'), {reason:true});
    if (!reason) return;
    try { await api(base + '/purge', { method: 'POST', body: JSON.stringify({ workflow_id: id, reason, confirmation: id ? `DELETE WORKFLOW ${id}` : 'DELETE ALL WORKFLOWS' }) }); state.dirty = false; await close(true); await refreshViews(); }
    catch (error) { failure(error); }
  }
  return { open, openCalendar, create, settings, purge, refreshViews, mountDate, close, ask, adminReason, errorMessage };
})();
// This alias names the shared contract; it is not a second implementation.
window.WorkflowDetailsModal = window.WorkshopV2;
