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
  const needsReason = () => isAdministrator() && !isSuper();
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
    WORKFLOW_FORBIDDEN: ['You do not have permission for this item.', 'Ehhez az elemhez nincs m\u00f3dos\u00edt\u00e1si jogosults\u00e1god.'],
    WORKFLOW_VERSION_CONFLICT: ['This workflow changed elsewhere. Reload before saving.', 'A workflow k\u00f6zben megv\u00e1ltozott. Ment\u00e9s el\u0151tt t\u00f6ltsd \u00fajra.'],
    WORKFLOW_TIME_INVALID: ['Choose a valid date and a 30-minute time slot.', 'V\u00e1lassz \u00e9rv\u00e9nyes d\u00e1tumot \u00e9s 30 perces id\u0151s\u00e1vot.'],
    WORKFLOW_TIME_DST_GAP: ['That New York time does not exist due to the clock change.', 'Ez a New York-i id\u0151pont az \u00f3ra\u00e1t\u00e1ll\u00edt\u00e1s miatt nem l\u00e9tezik.'],
    WORKFLOW_DATE_ORDER: ['The deadline cannot precede the start.', 'A hat\u00e1rid\u0151 nem el\u0151zheti meg a kezd\u00e9st.'],
    WORKFLOW_PHASE_OUTSIDE_DATES: ['The phase must stay within the workflow dates.', 'A f\u00e1zis hat\u00e1ridej\u00e9nek a workflow id\u0151hat\u00e1rain bel\u00fcl kell maradnia.'],
    WORKFLOW_TASK_OUTSIDE_DATES: ['The task must stay within its phase deadline.', 'A r\u00e9szfeladat nem l\u00e9pheti t\u00fal a f\u00e1zis hat\u00e1ridej\u00e9t.'],
    WORKFLOW_OVERRIDE_REASON_REQUIRED: ['An Admin action needs a reason of at least five characters.', 'Az Admin m\u0171velethez legal\u00e1bb \u00f6tkarakteres indokl\u00e1s kell.'],
    WORKFLOW_HANDOVER_REASON_REQUIRED: ['Provide the reason for the handover.', 'Add meg az \u00e1tad\u00e1s indok\u00e1t.'],
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
    return errors[code] ? tr(...errors[code]) : code;
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
  async function adminReason(promptWhenMissing = false) {
    if (!needsReason()) return '';
    let value = state.dialog?.open ? state.dialog.querySelector('[data-admin-reason]')?.value.trim() || state.reason : '';
    if (value.length < 5 && promptWhenMissing) value = await ask(tr('Admin action: provide an auditable reason (at least five characters).', 'Admin m\u0171velet: adj audit\u00e1lhat\u00f3 indokl\u00e1st (legal\u00e1bb \u00f6t karakter).'), true);
    if (value === null) return null;
    if (value.length < 5) throw new Error('WORKFLOW_OVERRIDE_REASON_REQUIRED');
    state.reason = value; return value;
  }
  const reasonMarkup = () => needsReason() ? `<section class="wf2-admin-reason">${field(tr('Admin audit reason (required for every change)', 'Admin auditindokl\u00e1s (minden m\u00f3dos\u00edt\u00e1shoz k\u00f6telez\u0151)'), `<textarea data-admin-reason rows="2" minlength="5" maxlength="2000">${esc(state.reason)}</textarea>`)}</section>` : '';
  function ensureDialog() {
    if (state.dialog) return state.dialog;
    const modal = document.createElement('dialog'); modal.id = 'workflow-v2-dialog'; modal.className = 'wf2-dialog';
    modal.setAttribute('aria-labelledby', 'wf2-title'); modal.setAttribute('data-ui-contract', 'UI12');
    modal.addEventListener('click', event => { void click(event).catch(failure); });
    modal.addEventListener('submit', event => { event.preventDefault(); void submit(event).catch(failure); });
    modal.addEventListener('input', event => { if (!event.target.matches('[data-search]')) state.dirty = true; if (event.target.matches('[data-search]')) searchSelect(event.target); });
    modal.addEventListener('change', event => { void change(event).catch(failure); });
    modal.addEventListener('cancel', event => { event.preventDefault(); void close(); });
    document.body.append(modal); state.dialog = modal; return modal;
  }
  function shell(title, content) {
    const modal = ensureDialog();
    modal.innerHTML = `<header class="wf2-header"><div><small>${tr('Workshop workflow \u00b7 UI12', 'M\u0171hely workflow \u00b7 UI12')}</small><h2 id="wf2-title">${esc(title)}</h2></div>${button('\u00d7', 'close', `class="wf2-close" aria-label="${esc(tr('Close', 'Bez\u00e1r\u00e1s'))}"`)}</header><div class="wf2-error" data-wf-error role="alert" tabindex="-1" hidden></div><main>${content}</main>`;
    if (!modal.open) { state.focus = document.activeElement; modal.showModal(); }
    modal.setAttribute('aria-busy', String(state.busy)); state.dirty = false;
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
    const day = box.dataset.draftDay || value.slice(0, 10) || nyDay();
    const monthKey = month || box.dataset.month || day.slice(0, 7); box.dataset.month = monthKey;
    const [year, number] = monthKey.split('-').map(Number), first = new Date(Date.UTC(year, number - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7, count = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const time = box.dataset.draftTime ?? (value.slice(11) || '09:00');
    const aligned = /^\d{2}:(00|30)$/.test(time);
    const slots = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
    const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(hu() ? 'hu-HU' : 'en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, i + 1))));
    const days = '<span></span>'.repeat(offset) + Array.from({ length: count }, (_, i) => {
      const key = `${monthKey}-${String(i + 1).padStart(2, '0')}`;
      return `<button type="button" data-date-action="day" data-day="${key}" aria-pressed="${day === key}" class="${day === key ? 'selected' : ''}">${i + 1}</button>`;
    }).join('');
    box.querySelector('.wf2-date-panel').innerHTML = `<div class="wf2-month"><button type="button" data-date-action="previous" aria-label="${esc(tr('Previous month', 'El\u0151z\u0151 h\u00f3nap'))}">\u2039</button><strong>${esc(new Intl.DateTimeFormat(hu() ? 'hu-HU' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first))}</strong><button type="button" data-date-action="next" aria-label="${esc(tr('Next month', 'K\u00f6vetkez\u0151 h\u00f3nap'))}">\u203a</button></div><div class="wf2-days">${weekdays.map(item => `<small>${esc(item)}</small>`).join('')}${days}</div>${field(tr('Time \u00b7 New York \u00b7 30-minute slots', 'Id\u0151 \u00b7 New York \u00b7 30 perces id\u0151s\u00e1vok'), `<select data-native-select="true" data-date-time>${!aligned ? `<option value="" selected disabled>${esc(tr('Choose a new half-hour slot', 'V\u00e1lassz \u00faj f\u00e9l\u00f3r\u00e1s id\u0151s\u00e1vot'))}</option>` : ''}${slots.map(slot => `<option value="${slot}"${selected(slot === time)}>${slot}</option>`).join('')}</select>`)}${!aligned ? `<p class="wf2-note">${esc(tr('The saved legacy time is preserved until you select a new time.', 'A kor\u00e1bbi mentett id\u0151pont megmarad, am\u00edg \u00fajat nem v\u00e1lasztasz.'))}</p>` : ''}<div class="wf2-date-actions"><button type="button" data-date-action="today">${tr('Today', 'Ma')}</button>${!box.querySelector('input').dataset.dateRequired ? `<button type="button" data-date-action="clear">${tr('Clear', 'T\u00f6rl\u00e9s')}</button>` : ''}<button type="button" data-date-action="done">${tr('Done', 'K\u00e9sz')}</button></div>`;
  }
  function dateSet(box, value) {
    const hidden = box.querySelector('input'); if (hidden.value === value) return;
    hidden.value = value; box.querySelector('.wf2-date-toggle span').textContent = value ? value.replace('T', ' ') : tr('Choose date and time', 'D\u00e1tum \u00e9s id\u0151 kiv\u00e1laszt\u00e1sa');
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
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
      box.dataset.draftDay = action === 'today' ? nyDay() : control.dataset.day;
      const time = panel.querySelector('[data-date-time]').value;
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
    for (const item of form.querySelectorAll('[data-date-required]')) if (!item.value) throw new Error('WORKFLOW_TIME_INVALID');
  }

  function searchable(name, title, items, value = '') {
    return `<div class="wf2-searchable">${field(title, `<input type="search" data-search="${name}" placeholder="${esc(tr('Search...', 'Keres\u00e9s...'))}" autocomplete="off"><select data-native-select="true" name="${name}" required><option value="">${tr('Select...', 'V\u00e1lassz...')}</option>${items.map(item => `<option value="${esc(item.id)}"${selected(item.id === value)}>${esc(item.name)}</option>`).join('')}</select>`)}</div>`;
  }
  function pianoItems(clientId) {
    return (state.options?.pianos || []).filter(piano => !clientId || piano.owner_contact_id === clientId || state.options.client_pianos.some(link => link.client_id === clientId && link.piano_id === piano.id))
      .map(piano => ({ id: piano.id, name: [piano.brand, piano.model, piano.serial_no ? `#${piano.serial_no}` : ''].filter(Boolean).join(' \u2013 ') || piano.display_name || piano.id }));
  }
  function searchSelect(search) {
    const select = search.closest('.wf2-searchable').querySelector('select'); const query = search.value.trim().toLocaleLowerCase();
    for (const option of select.options) option.hidden = Boolean(option.value && !option.textContent.toLocaleLowerCase().includes(query));
  }
  function transferMarkup(name, value, off = false) {
    return `<div class="wf2-transfer"><div class="wf2-transfer-select">${field(tr('Responsible colleague', 'Felel\u0151s munkat\u00e1rs'), `<select data-native-select="true" name="${name}" data-responsible data-original="${esc(value)}"${disabled(off)}>${userOptions(value)}</select>`)}${!off ? button(tr('Handover', '\u00c1tad\u00e1s'), 'handover') : ''}</div><label data-transfer-reason hidden>${tr('Reason for handover', '\u00c1tad\u00e1s oka...')}<textarea name="transfer_reason" rows="2" maxlength="2000"></textarea></label></div>`;
  }
  function assigneesMarkup(values, off = false) {
    return `<fieldset class="wf2-assignees"${disabled(off)}><legend>${tr('Subresponsibles', 'Alfelel\u0151s\u00f6k')}</legend>${(state.options.users || []).map(person => `<label><input type="checkbox" name="assignee_ids" value="${esc(person.id)}"${checked(values.includes(person.id))}><span>${esc(person.name)}</span></label>`).join('')}</fieldset>`;
  }
  async function create() {
    if (!await mayNavigate()) return;
    const sequence = ++state.sequence; state.reason = ''; state.mode = 'create'; state.workflow = null;
    shell(tr('New workflow', '\u00daj workflow'), `<p>${tr('Loading...', 'Bet\u00f6lt\u00e9s...')}</p>`);
    try {
      const options = await api(base + '/options'); if (sequence !== state.sequence) return; state.options = options;
      state.requestKey = window.crypto?.randomUUID?.() || `create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const day = nyDay();
      shell(tr('New workflow', '\u00daj workflow'), `${reasonMarkup()}<form data-wf-form="create"><div class="wf2-grid">${field(tr('Workflow title', 'Workflow megnevez\u00e9se'), input('title', '', 'required maxlength="200"'))}${field(tr('Main responsible', 'F\u0151 felel\u0151s'), `<select data-native-select="true" name="main_responsible_user_id" required>${userOptions(actor()?.id)}</select>`)}${searchable('client_id', tr('Client', '\u00dcgyf\u00e9l'), options.clients)}${searchable('piano_id', tr('Piano', 'Zongora'), pianoItems(''))}${dateField('start_at', day + 'T09:00', tr('Start \u00b7 New York', 'Kezd\u00e9s \u00b7 New York'), true)}${dateField('final_due_at', day + 'T17:00', tr('Final deadline \u00b7 New York', 'V\u00e9gs\u0151 hat\u00e1rid\u0151 \u00b7 New York'), true)}</div>${field(tr('Workflow type', 'Workflow t\u00edpusa'), '<select data-native-select="true" name="mode"><option value="INBOUND">'+tr('In workshop','M\u0171helyben')+'</option><option value="ON_SITE">'+tr('On site','Helysz\u00ednen')+'</option></select>')}${field(tr('Description', 'Le\u00edr\u00e1s'), '<textarea name="description" rows="2" maxlength="5000"></textarea>')}<fieldset><legend>${tr('Activate phases individually', 'F\u00e1zisok egyedi aktiv\u00e1l\u00e1sa')}</legend><p class="wf2-note">${tr('Only checked phases will be created. Each active phase has exactly one responsible.', 'Csak a bejel\u00f6lt f\u00e1zisok j\u00f6nnek l\u00e9tre. Minden akt\u00edv f\u00e1zisnak pontosan egy felel\u0151se van.')}</p><div class="wf2-create-phases">${options.stages.map(stage => `<section data-create-phase="${esc(stage.code)}" class="wf2-create-phase"><label class="wf2-toggle"><input type="checkbox" data-phase-enabled${checked(stage.enabled !== 0)}><strong>${esc(hu() ? stage.name_hu : stage.name_en)}</strong></label><div data-phase-fields${stage.enabled === 0 ? ' hidden' : ''}>${field(tr('Phase responsible', 'F\u00e1zisfelel\u0151s'), `<select data-native-select="true" data-phase-responsible>${userOptions(actor()?.id)}</select>`)}${dateField('phase_due_' + stage.code, '', tr('Phase deadline (defaults to final deadline)', 'F\u00e1zishat\u00e1rid\u0151 (alap\u00e9rtelmez\u00e9s: v\u00e9gs\u0151 hat\u00e1rid\u0151)'))}</div></section>`).join('')}</div></fieldset><div class="wf2-actions"><button type="submit">${tr('Create workflow', 'Workflow l\u00e9trehoz\u00e1sa')}</button>${button(tr('Cancel', 'M\u00e9gse'), 'close')}</div></form>`);
    } catch (error) { failure(error); }
  }
  function callBadge(phone) {
    const dial = String(phone || '').replace(/[^+0-9*#,;]/g, '');
    return dial ? `<a class="wf2-call" href="tel:${esc(dial)}">${esc(phone)}</a>` : '';
  }
  function peopleHeader(w) {
    const owner = `<p><strong>${tr('Owner:', 'Tulajdonos:')}</strong> ${esc(w.owner_name || tr('Not recorded', 'Nincs r\u00f6gz\u00edtve'))} ${callBadge(w.owner_phone)}</p>`;
    const client = w.owner_is_client ? '' : `<p><strong>${tr('Client:', '\u00dcgyf\u00e9l:')}</strong> ${esc(w.client_name)} ${callBadge(w.client_phone)}</p>`;
    return `<section class="wf2-summary"><div data-owner-client>${owner}${client}</div><div><span class="wf2-status">${esc(statusText(w.status))}</span><p>${esc(w.title)}</p><small>${tr('Created by', 'L\u00e9trehoz\u00f3')}: ${esc(w.creator_name || w.creator_user_id)}<br>${tr('Main responsible', 'F\u0151 felel\u0151s')}: ${esc(w.main_responsible_name || userName(w.main_responsible_user_id))}</small></div></section>`;
  }
  function tasksMarkup(p) {
    const tasks = p.tasks || [], manager = p.permissions.edit_task_content;
    const total = tasks.length, done = tasks.filter(task => task.status === 'COMPLETED').length;
    return `<section class="wf2-section"><h3>${tr('Tasks', 'R\u00e9szfeladatok')}</h3><div class="wf2-progress" aria-live="polite"><progress value="${done}" max="${Math.max(1, total)}"></progress><strong>${done}/${total} ${tr('done', 'k\u00e9sz')}</strong></div>${tasks.map(task => {
      const complete = task.status === 'COMPLETED';
      const canReopen = p.permissions.reopen && state.workflow.status === 'ACTIVE';
      return `<article class="wf2-task" data-task="${esc(task.id)}"><div class="wf2-task-title"><label class="wf2-toggle"><input type="checkbox" data-task-complete="${esc(task.id)}"${checked(complete)}${disabled(complete ? !canReopen : !task.permissions.complete_task)}><strong>${esc(task.title)}</strong></label><span>${esc(statusText(task.status))}</span></div><p class="wf2-note">${esc((task.assignee_ids || []).map(userName).join(', '))}</p>${task.permissions.edit_task ? `<form data-wf-form="task" data-task-id="${esc(task.id)}">${task.permissions.edit_task_content ? field(tr('Title', 'Megnevez\u00e9s'), input('title', task.title, 'required maxlength="200"')) + assigneesMarkup(task.assignee_ids) : ''}${dateField('due_at', task.due_at, tr('Task deadline', 'R\u00e9szfeladat hat\u00e1rideje'))}<div class="wf2-actions"><button type="submit">${tr('Save task', 'R\u00e9szfeladat ment\u00e9se')}</button>${manager ? button(tr('Delete task', 'R\u00e9szfeladat t\u00f6rl\u00e9se'), 'task-delete', `data-id="${esc(task.id)}"`) : ''}</div></form>` : `<p>${esc(task.due_at?.replace('T', ' ') || '')}</p>${complete && canReopen ? button(tr('Reopen', '\u00dajranyit\u00e1s'), 'task-reopen', `data-id="${esc(task.id)}"`) : ''}`}</article>`;
    }).join('')}${manager ? `<details class="wf2-add"><summary>${tr('+ Add task', '+ R\u00e9szfeladat hozz\u00e1ad\u00e1sa')}</summary><form data-wf-form="task">${field(tr('Task title', 'R\u00e9szfeladat neve'), input('title', '', 'required maxlength="200"'))}${assigneesMarkup([p.responsible_user_id])}${dateField('due_at', p.due_at, tr('Task deadline', 'R\u00e9szfeladat hat\u00e1rideje'))}<button type="submit">${tr('Add task', 'R\u00e9szfeladat hozz\u00e1ad\u00e1sa')}</button></form></details>` : ''}</section>`;
  }
  function checklistMarkup(p) {
    const manager = p.permissions.edit_task_content;
    return `<section class="wf2-section"><h3>${tr('Checklist', 'Ellen\u0151rz\u0151lista')}</h3>${(p.checklist || []).map(item => {
      const task = p.tasks?.find(t => t.id === item.task_id);
      const canEdit = (manager || task?.permissions.complete_task) && (!item.checked || p.permissions.reopen) && task?.status !== 'COMPLETED';
      return `<div class="wf2-check"><label><input type="checkbox" data-check-id="${esc(item.id)}"${checked(item.checked)}${disabled(!canEdit)}><span>${esc(item.title)}${task ? ` <small>(${esc(task.title)})</small>` : ''}</span></label>${manager ? button(tr('Remove', 'T\u00f6rl\u00e9s'), 'check-delete', `data-id="${esc(item.id)}"`) : ''}</div>`;
    }).join('')}${manager ? `<form data-wf-form="checklist"><div class="wf2-grid">${field(tr('Checklist item', 'Listaelem'), input('title', '', 'required maxlength="200"'))}${field(tr('Related task (optional)', 'Kapcsol\u00f3d\u00f3 r\u00e9szfeladat (opcion\u00e1lis)'), `<select data-native-select="true" name="task_id"><option value="">${tr('Whole phase', 'Teljes f\u00e1zis')}</option>${(p.tasks || []).filter(t => t.status !== 'COMPLETED').map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('')}</select>`)}</div><button type="submit">${tr('+ Add checklist item', '+ Listaelem hozz\u00e1ad\u00e1sa')}</button></form>` : ''}</section>`;
  }
  function costsMarkup(p) {
    const categories = [['MATERIAL', tr('Material', 'Anyag')], ['TRANSPORT', tr('Transport', 'Sz\u00e1ll\u00edt\u00e1s')], ['CONTRACTOR', tr('Subcontractor', 'Alv\u00e1llalkoz\u00f3')], ['OTHER', tr('Other', 'Egy\u00e9b')]];
    return `<section class="wf2-section"><h3>${tr('Internal phase costs', 'Bels\u0151 f\u00e1zisk\u00f6lts\u00e9gek')}</h3><p class="wf2-note">${tr('Recording a cost posts it to workshop WIP immediately. Abandonment writes off unreleased WIP; posted journals are retained.', 'A r\u00f6gz\u00edt\u00e9s azonnal m\u0171hely-WIP-re k\u00f6nyvel. Megszak\u00edt\u00e1skor a fel nem oldott WIP vesztes\u00e9gk\u00e9nt le\u00edr\u00f3dik; a napl\u00f3t\u00e9telek megmaradnak.')}</p>${(p.costs || []).map(cost => `<article class="wf2-cost${cost.voided_at ? ' is-voided' : ''}"><div><strong>${esc(cost.title)}</strong><p>${esc(categories.find(item => item[0] === cost.category)?.[1] || cost.category)} \u00b7 ${esc(formatMoney(cost.amount_cents))}</p><small>${cost.voided_at ? tr('Written off', 'Le\u00edrva') : cost.approval_status === 'PENDING' ? tr('Awaiting main responsible approval', 'F\u0151 felel\u0151s j\u00f3v\u00e1hagy\u00e1s\u00e1ra v\u00e1r') : tr('Approved', 'J\u00f3v\u00e1hagyva')}</small></div><div class="wf2-actions">${!cost.voided_at && cost.approval_status === 'PENDING' && p.permissions.approve_cost ? button(tr('Approve', 'J\u00f3v\u00e1hagy\u00e1s'), 'cost-approve', `data-id="${esc(cost.id)}"`) : ''}${!cost.voided_at && p.permissions.record_cost && p.permissions.approve_cost ? button(tr('Write off cost', 'K\u00f6lts\u00e9g le\u00edr\u00e1sa'), 'cost-delete', `data-id="${esc(cost.id)}"`) : ''}</div></article>`).join('')}${p.permissions.record_cost ? `<form data-wf-form="cost"><div class="wf2-grid">${field(tr('Amount (USD)', '\u00d6sszeg (USD)'), '<input name="amount" type="number" inputmode="decimal" min="0.01" max="100000000" step="0.01" required>')}${field(tr('Category', 'Kateg\u00f3ria'), `<select data-native-select="true" name="category">${categories.map(([id, title]) => `<option value="${id}">${esc(title)}</option>`).join('')}</select>`)}${field(tr('Description (optional)', 'Megnevez\u00e9s (opcion\u00e1lis)'), input('title', '', 'maxlength="200"'))}${field(tr('Supplier (optional)', 'Sz\u00e1ll\u00edt\u00f3 (opcion\u00e1lis)'), `<select data-native-select="true" name="partner_id"><option value="">${tr('Internal / paid cost', 'Bels\u0151 / kifizetett k\u00f6lts\u00e9g')}</option>${state.options.partners.map(item => `<option value="${esc(item.id)}">${esc(item.company_name)}</option>`).join('')}</select>`)}</div><details><summary>${tr('Customer billing (optional)', '\u00dcgyf\u00e9l fel\u00e9 sz\u00e1ml\u00e1z\u00e1s (opcion\u00e1lis)')}</summary><div class="wf2-grid">${field(tr('Billing', 'Sz\u00e1ml\u00e1z\u00e1s'), `<select data-native-select="true" name="billing_status"><option value="FREE">${tr('Internal only', 'Csak bels\u0151 r\u00e1ford\u00edt\u00e1s')}</option><option value="CHARGEABLE">${tr('Chargeable', 'Sz\u00e1ml\u00e1zhat\u00f3')}</option><option value="WARRANTY">${tr('Warranty', 'Garancia')}</option></select>`)}${field(tr('Customer charge (USD)', '\u00dcgyf\u00e9lnek sz\u00e1ml\u00e1zott \u00f6sszeg (USD)'), '<input name="charge_amount" type="number" inputmode="decimal" min="0" step="0.01" value="0">')}</div></details><button type="submit">${tr('+ Record cost', '+ K\u00f6lts\u00e9g r\u00f6gz\u00edt\u00e9se')}</button></form>` : ''}</section>`;
  }
  function documentsMarkup(p) {
    return `<section class="wf2-section"><h3>${tr('Documents', 'Dokumentumok')}</h3>${(p.documents || []).map(doc => `<div class="wf2-document"><span>${esc(doc.original_name)}</span>${button(tr('Open', 'Megnyit\u00e1s'), 'document-open', `data-id="${esc(doc.id)}"`)}${p.permissions.edit_phase ? button(tr('Remove', 'T\u00f6rl\u00e9s'), 'document-delete', `data-id="${esc(doc.id)}"`) : ''}</div>`).join('')}${p.permissions.edit_phase ? `<form data-wf-form="document">${field(tr('File (up to 20 MB)', 'F\u00e1jl (legfeljebb 20 MB)'), '<input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx" required>')}<button type="submit">${tr('Upload', 'Felt\u00f6lt\u00e9s')}</button></form>` : ''}</section>`;
  }
  function phaseMarkup(p) {
    const edit = p.permissions.edit_phase;
    return `<section class="wf2-phase" data-phase-id="${esc(p.id)}"><h3>${esc(phaseName(p))}</h3><form data-wf-form="phase"><fieldset${disabled(!edit)}><div class="wf2-grid">${field(tr('Phase title', 'F\u00e1zis neve'), input('title', p.title, 'required maxlength="200"'))}${dateField('due_at', p.due_at, tr('Phase deadline', 'F\u00e1zishat\u00e1rid\u0151'))}</div>${transferMarkup('responsible_user_id', p.responsible_user_id, !p.permissions.assign_phase)}${field(tr('Description', 'Le\u00edr\u00e1s'), `<textarea name="description" rows="2">${esc(p.description)}</textarea>`)}${field(tr('Phase status', 'F\u00e1zis \u00e1llapota'), `<select data-native-select="true" name="status">${['WAITING', 'IN_PROGRESS', 'BLOCKED', ...(p.status === 'COMPLETED' ? ['COMPLETED'] : [])].map(item => `<option value="${item}"${selected(p.status === item)}>${esc(statusText(item))}</option>`).join('')}</select>`)}${edit ? '<button type="submit">' + tr('Save phase', 'F\u00e1zis ment\u00e9se') + '</button>' : ''}</fieldset></form><div class="wf2-actions">${edit ? button(tr('Complete phase', 'F\u00e1zis lez\u00e1r\u00e1sa'), 'phase-close') : ''}${p.status === 'COMPLETED' && p.permissions.reopen && state.workflow.status === 'ACTIVE' ? button(tr('Reopen phase', 'F\u00e1zis \u00fajranyit\u00e1sa'), 'phase-reopen') : ''}${p.permissions.delete_phase ? button(tr('Remove phase and write off WIP', 'F\u00e1zis t\u00f6rl\u00e9se \u00e9s WIP le\u00edr\u00e1sa'), 'phase-delete', 'class="danger-btn"') : ''}</div>${tasksMarkup(p)}${checklistMarkup(p)}${costsMarkup(p)}${documentsMarkup(p)}</section>`;
  }
  function renderDetails() {
    const w = state.workflow; if (!w) return;
    if (!(w.stages || []).some(p => p.id === state.phaseId)) state.phaseId = w.stages?.[0]?.id || '';
    const p = currentPhase(), editable = w.permissions.edit_workflow;
    const missing = state.options.stages.filter(stage => !w.stages.some(phase => phase.stage_code === stage.code));
    const heading = [w.brand, w.model].filter(Boolean).join(' \u2013 ') || w.display_name || tr('Workflow details', 'Workflow r\u00e9szletei');
    const closeout = w.permissions.close_workflow ? `<section class="wf2-section wf2-closeout"><h3>${tr('Close the entire workflow', 'Teljes workflow lez\u00e1r\u00e1sa')}</h3><p>${tr('Only the main responsible or a system administrator may close the entire workflow.', 'A teljes workflow-t csak a f\u0151 felel\u0151s vagy rendszergazda z\u00e1rhatja le.')}</p><form data-wf-form="closeout">${field(tr('Payment method (only for a billable customer invoice)', 'Fizet\u00e9si m\u00f3d (csak sz\u00e1ml\u00e1zhat\u00f3 \u00fcgyf\u00e9lsz\u00e1ml\u00e1hoz)'), `<select data-native-select="true" name="payment_method"><option value="">${tr('No invoice / select', 'Nincs sz\u00e1mla / v\u00e1lassz')}</option><option value="Bank Transfer / ACH">${tr('Bank transfer', 'Banki \u00e1tutal\u00e1s')}</option><option value="CASH">${tr('Cash', 'K\u00e9szp\u00e9nz')}</option><option value="CREDIT CARD">${tr('Card', 'Bankk\u00e1rtya')}</option><option value="CHECK">${tr('Check', 'Csekk')}</option></select>`)}${needsReason() ? `<label class="wf2-toggle"><input name="override" type="checkbox">${tr('Override unfinished items and record each change in the audit.', 'Befejezetlen elemek fel\u00fclb\u00edr\u00e1l\u00e1sa, minden m\u00f3dos\u00edt\u00e1s audit\u00e1l\u00e1s\u00e1val.')}</label>` : ''}<button type="submit">${tr('Close workflow', 'Workflow lez\u00e1r\u00e1sa')}</button></form></section>` : '';
    shell(heading, `${peopleHeader(w)}${w.historical ? `<p class="wf2-note">${tr('Historical financial record. Read only.', 'T\u00f6rt\u00e9neti p\u00e9nz\u00fcgyi rekord. Csak olvashat\u00f3.')}</p>` : reasonMarkup()}${w.finance_locked && w.status === 'ACTIVE' ? `<p class="wf2-note">${tr('Operationally reopened. The existing invoice and financial close remain locked; no duplicate billing is permitted.', 'M\u0171k\u00f6d\u00e9sileg \u00fajranyitva. A kor\u00e1bbi sz\u00e1mla \u00e9s p\u00e9nz\u00fcgyi z\u00e1r\u00e1s v\u00e9dett; nincs ism\u00e9telt sz\u00e1ml\u00e1z\u00e1s.')}</p>` : ''}<details class="wf2-section" ${w.stages.length ? '' : 'open'}><summary>${tr('Workflow administration', 'Workflow adminisztr\u00e1ci\u00f3')}</summary><form data-wf-form="workflow"><fieldset${disabled(!editable)}>${field(tr('Workflow title', 'Workflow neve'), input('title', w.title, 'required maxlength="200"'))}${transferMarkup('main_responsible_user_id', w.main_responsible_user_id, !editable)}<div class="wf2-grid">${dateField('start_at', w.start_at, tr('Start \u00b7 New York', 'Kezd\u00e9s \u00b7 New York'), !w.historical)}${dateField('final_due_at', w.final_due_at, tr('Final deadline \u00b7 New York', 'V\u00e9gs\u0151 hat\u00e1rid\u0151 \u00b7 New York'), true)}</div>${field(tr('Description', 'Le\u00edr\u00e1s'), `<textarea name="description" rows="2">${esc(w.description)}</textarea>`)}${editable ? '<button type="submit">' + tr('Save workflow', 'Workflow ment\u00e9se') + '</button>' : ''}</fieldset></form></details><nav class="wf2-phase-nav" aria-label="${esc(tr('Phases', 'F\u00e1zisok'))}">${w.stages.map(phase => button(phaseName(phase), 'phase-select', `data-id="${esc(phase.id)}" aria-pressed="${phase.id === state.phaseId}"`)).join('')}</nav>${p ? phaseMarkup(p) : `<p>${tr('No active phases.', 'Nincs akt\u00edv f\u00e1zis.')}</p>`}${editable && !w.finance_locked && missing.length ? `<form data-wf-form="add-phase" class="wf2-section">${field(tr('Activate another phase', 'Tov\u00e1bbi f\u00e1zis aktiv\u00e1l\u00e1sa'), `<select data-native-select="true" name="stage_code">${missing.map(stage => `<option value="${esc(stage.code)}">${esc(hu() ? stage.name_hu : stage.name_en)}</option>`).join('')}</select>`)}<button type="submit">${tr('Activate phase', 'F\u00e1zis aktiv\u00e1l\u00e1sa')}</button></form>` : ''}${closeout}<div class="wf2-actions">${w.status === 'COMPLETED' && w.permissions.reopen ? button(tr('Reopen workflow', 'Workflow \u00fajranyit\u00e1sa'), 'workflow-reopen') : ''}${w.permissions.delete_workflow ? button(tr('Abandon workflow', 'Workflow megszak\u00edt\u00e1sa'), 'workflow-abort', 'class="danger-btn"') + button(tr('Delete workflow', 'Workflow t\u00f6rl\u00e9se'), 'workflow-delete', 'class="danger-btn"') : ''}${button(tr('Reload', '\u00dajrat\u00f6lt\u00e9s'), 'reload')}</div><details class="wf2-section"><summary>${tr('Audit trail', 'Auditnapl\u00f3')}</summary>${(w.audit || []).map(item => `<article class="wf2-audit"><strong>${esc(item.action)}</strong> \u00b7 ${esc(item.actor_name)}<br><small>${esc(item.created_at)} \u00b7 ${esc(item.entity_type)}</small><p>${esc(item.reason)}</p><details><summary>${tr('Recorded change', 'R\u00f6gz\u00edtett m\u00f3dos\u00edt\u00e1s')}</summary><pre>${esc(item.before_json || '')}\n\u2192\n${esc(item.after_json || '')}</pre></details></article>`).join('') || `<p>${tr('No mandatory business audit entries.', 'Nincs k\u00f6telez\u0151 \u00fczleti auditbejegyz\u00e9s.')}</p>`}</details>`);
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
    if (!form.reportValidity()) return; validateDates(form);
    const kind = form.dataset.wfForm, body = values(form);
    if (kind === 'create') {
      body.request_key = state.requestKey; body.mode = body.mode || 'INBOUND';
      body.phases = [...form.querySelectorAll('[data-create-phase]')].map(section => ({ stage_code: section.dataset.createPhase, enabled: section.querySelector('[data-phase-enabled]').checked, responsible_user_id: section.querySelector('[data-phase-responsible]').value, due_at: section.querySelector('.wf2-date input').value || null }));
      for (const key of Object.keys(body)) if (key.startsWith('phase_due_')) delete body[key];
      await mutate(base + '/workflows', 'POST', body); return;
    }
    if (kind === 'settings') {
      const stages = [...form.querySelectorAll('[data-setting-code]')].map(section => ({ code: section.dataset.settingCode, name_en: section.querySelector('[name=name_en]').value.trim(), name_hu: section.querySelector('[name=name_hu]').value.trim(), sort_order: Number(section.querySelector('[name=sort_order]').value), color: section.querySelector('[name=color]').value, enabled: section.querySelector('[name=enabled]').checked, required: section.querySelector('[name=required]').checked, default_status: section.querySelector('[name=default_status]').value }));
      const result = await mutate(base + '/phases', 'PUT', { stages }); if (result) { state.dirty = false; await close(true); } return;
    }
    if (kind === 'workflow') { await mutate(apiPath(), 'PUT', body); return; }
    if (kind === 'phase') { if (!currentPhase().permissions.assign_phase) delete body.responsible_user_id; await mutate(apiPath(phasePath()), 'PUT', body); return; }
    if (kind === 'task') {
      const task = currentPhase().tasks.find(item => item.id === form.dataset.taskId);
      const payload = { due_at: body.due_at || null };
      if (!task || task.permissions.edit_task_content) { payload.title = body.title; payload.assignee_ids = new FormData(form).getAll('assignee_ids'); if (!payload.assignee_ids.length) throw new Error('WORKFLOW_ASSIGNEES_REQUIRED'); }
      await mutate(apiPath(phasePath() + '/tasks' + (task ? '/' + encodeURIComponent(task.id) : '')), task ? 'PUT' : 'POST', payload); return;
    }
    if (kind === 'cost') { body.amount = Number(body.amount); body.charge_amount = body.billing_status === 'CHARGEABLE' ? Number(body.charge_amount || 0) : 0; await mutate(apiPath(phasePath() + '/costs'), 'POST', body); return; }
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
    if (target.matches('[data-admin-reason]')) { state.reason = target.value.trim(); return; }
    if (target.matches('[data-responsible]')) {
      const section = target.closest('.wf2-transfer'); section.querySelector('[data-transfer-reason]').hidden = target.value === target.dataset.original && section.dataset.forced !== '1'; return;
    }
    if (target.matches('[data-phase-enabled]')) { target.closest('[data-create-phase]').querySelector('[data-phase-fields]').hidden = !target.checked; return; }
    if (target.matches('[data-phase-responsible]')) { target.dataset.manual = '1'; return; }
    if (state.mode === 'create' && target.name === 'main_responsible_user_id') { for (const select of state.dialog.querySelectorAll('[data-phase-responsible]')) if (!select.dataset.manual) select.value = target.value; return; }
    if (state.mode === 'create' && target.name === 'client_id') {
      const form = target.form, select = form.querySelector('[name=piano_id]'), previous = select.value;
      select.innerHTML = `<option value="">${tr('Select...', 'V\u00e1lassz...')}</option>` + pianoItems(target.value).map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
      form.querySelector('[data-search=piano_id]').value = ''; return;
    }
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
    if (action === 'close') return close();
    if (action === 'handover') { const wrapper = control.closest('.wf2-transfer'); wrapper.dataset.forced = '1'; wrapper.querySelector('[data-transfer-reason]').hidden = false; wrapper.querySelector('textarea').focus(); return; }
    if (action === 'phase-select') { if (!await mayNavigate()) return; state.reason = state.dialog.querySelector('[data-admin-reason]')?.value || state.reason; state.phaseId = control.dataset.id; renderDetails(); return; }
    if (action === 'reload') return open(state.workflow.id, state.phaseId);
    if (action === 'document-open') return downloadDocument(control.dataset.id);
    const loss = ['phase-delete', 'cost-delete', 'workflow-abort', 'workflow-delete'].includes(action);
    if (loss && !await ask(tr('Confirm this action? Unreleased workshop WIP will be posted as realized loss. Financial journals will not be deleted.', 'Meger\u0151s\u00edted? A fel nem oldott m\u0171hely-WIP realiz\u00e1lt vesztes\u00e9gk\u00e9nt k\u00f6nyvel\u0151dik. A k\u00f6nyvel\u00e9si napl\u00f3 nem t\u00f6rl\u0151dik.'))) return;
    if (!loss && ['task-delete', 'check-delete', 'document-delete', 'phase-close', 'phase-reopen', 'task-reopen', 'workflow-reopen'].includes(action) && !await ask(tr('Confirm this workflow action?', 'Meger\u0151s\u00edted ezt a workflow m\u0171veletet?'))) return;
    const actions = {
      'phase-close': [phasePath() + '/close', 'POST'], 'phase-reopen': [phasePath() + '/reopen', 'POST'], 'phase-delete': [phasePath(), 'DELETE'],
      'task-delete': [phasePath() + '/tasks/' + key, 'DELETE'], 'task-reopen': [phasePath() + '/tasks/' + key + '/reopen', 'POST'],
      'check-delete': [phasePath() + '/checklist/' + key, 'DELETE'], 'cost-delete': [phasePath() + '/costs/' + key, 'DELETE'], 'cost-approve': [phasePath() + '/costs/' + key + '/approve', 'POST'],
      'document-delete': [phasePath() + '/documents/' + key, 'DELETE'], 'workflow-abort': ['/abort', 'POST'], 'workflow-delete': ['', 'DELETE'], 'workflow-reopen': ['/reopen', 'POST']
    };
    const item = actions[action]; if (!item) return;
    const payload = loss ? { confirmed: true } : {};
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
    if (!await ask(tr('Delete the active, financially open workflow(s)? Unreleased WIP becomes realized loss. Invoices, journals, attachments and audit history remain preserved.', 'T\u00f6rl\u00f6d az akt\u00edv, p\u00e9nz\u00fcgyileg nyitott workflow-kat? A fel nem oldott WIP realiz\u00e1lt vesztes\u00e9gg\u00e9 v\u00e1lik. A sz\u00e1ml\u00e1k, napl\u00f3t\u00e9telek, mell\u00e9kletek \u00e9s audit megmaradnak.'))) return;
    try { await api(base + '/purge', { method: 'POST', body: JSON.stringify({ workflow_id: id, confirmation: id ? `DELETE WORKFLOW ${id}` : 'DELETE ALL WORKFLOWS' }) }); state.dirty = false; await close(true); await refreshViews(); }
    catch (error) { failure(error); }
  }
  return { open, openCalendar, create, settings, purge, refreshViews, mountDate, close, ask, adminReason, errorMessage };
})();
// This alias names the shared contract; it is not a second implementation.
window.WorkflowDetailsModal = window.WorkshopV2;
