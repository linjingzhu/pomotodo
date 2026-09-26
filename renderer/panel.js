// The expandable panel: Goals, Calendar (daily history) and Settings tabs,
// plus the Google Calendar connection controls inside Settings.
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.pomodoro;

  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const clock = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const duration = (sec) => {
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };

  function make(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    children.forEach((c) => node.append(c));
    return node;
  }

  // ---- tabs ----

  const tabs = ['goals', 'calendar', 'settings'];
  let activeTab = 'goals';

  function showTab(name) {
    activeTab = name;
    tabs.forEach((t) => {
      $(`tab-${t}`).classList.toggle('hidden', t !== name);
      $(`tab-btn-${t}`).setAttribute('aria-selected', String(t === name));
    });
    if (name === 'goals') loadGoals();
    if (name === 'calendar') loadMonth();
  }

  tabs.forEach((t) => $(`tab-btn-${t}`).addEventListener('click', () => showTab(t)));

  window.addEventListener('panel-toggled', (e) => {
    if (e.detail) showTab(activeTab);
  });

  // ---- goals ----

  async function loadGoals() {
    const goals = await api.listGoals();
    const list = $('goal-list');
    list.replaceChildren(...goals.map(goalItem));
    $('goals-empty').classList.toggle('hidden', goals.length > 0);
  }

  function goalItem(goal) {
    const check = make('input', { type: 'checkbox', checked: !!goal.doneAt, title: goal.doneAt ? 'Mark as not reached' : 'Mark as reached' });
    check.setAttribute('aria-label', `Reached: ${goal.title}`);
    check.addEventListener('change', async () => {
      check.disabled = true;
      await api.setGoalDone(goal.id, check.checked);
      await loadGoals();
      if (activeTab === 'calendar') loadMonth();
    });
    const when = goal.doneAt
      ? make('span', { className: 'goal-date', textContent: `reached ${new Date(goal.doneAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` })
      : '';
    const remove = make('button', { className: 'goal-delete', textContent: '×', title: 'Delete goal' });
    remove.setAttribute('aria-label', `Delete goal: ${goal.title}`);
    remove.addEventListener('click', async () => {
      await api.deleteGoal(goal.id);
      loadGoals();
    });
    const title = make('span', { className: 'goal-title', textContent: goal.title });
    return make('li', { className: goal.doneAt ? 'done' : '' }, [check, title, when, remove]);
  }

  $('goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('goal-input');
    if (!input.value.trim()) return;
    await api.addGoal(input.value);
    input.value = '';
    loadGoals();
  });

  // ---- calendar ----

  const today = new Date();
  let viewMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let selectedDay = dayKey(today);
  let monthData = { sessions: [], goalsDone: [] };

  function level(sec) {
    if (sec <= 0) return 0;
    if (sec < 30 * 60) return 1;
    if (sec < 90 * 60) return 2;
    if (sec < 180 * 60) return 3;
    return 4;
  }

  async function loadMonth() {
    monthData = await api.getMonthRecords(monthKey(viewMonth));
    renderMonth();
  }

  function renderMonth() {
    $('cal-title').textContent = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const perDay = {};
    monthData.sessions.forEach((s) => {
      const k = dayKey(new Date(s.start));
      perDay[k] = (perDay[k] || 0) + s.workedSec;
    });
    const goalDays = new Set(monthData.goalsDone.map((g) => dayKey(new Date(g.doneAt))));

    const cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => make('span', { className: 'cal-weekday', textContent: d }));
    for (let i = 0; i < viewMonth.getDay(); i++) cells.push(make('span'));
    const days = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const key = dayKey(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
      const sec = perDay[key] || 0;
      const cell = make('button', { className: `cal-day level-${level(sec)}`, textContent: String(d) });
      if (key === dayKey(today)) cell.classList.add('today');
      if (key === selectedDay) cell.classList.add('selected');
      if (goalDays.has(key)) cell.classList.add('goal');
      cell.title = sec ? `${duration(sec)} of focus` : 'No focus sessions';
      cell.addEventListener('click', () => {
        selectedDay = key;
        renderMonth();
      });
      cells.push(cell);
    }
    $('cal-grid').replaceChildren(...cells);
    renderDay();
  }

  function renderDay() {
    const sessions = monthData.sessions
      .filter((s) => dayKey(new Date(s.start)) === selectedDay)
      .sort((a, b) => a.start.localeCompare(b.start));
    const goals = monthData.goalsDone.filter((g) => dayKey(new Date(g.doneAt)) === selectedDay);
    const total = sessions.reduce((sum, s) => sum + s.workedSec, 0);
    const [y, m, d] = selectedDay.split('-').map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    $('cal-day-title').textContent = sessions.length
      ? `${label} · ${duration(total)} · ${sessions.length} session${sessions.length > 1 ? 's' : ''}`
      : label;

    const items = sessions.map((s) => {
      const note = make('input', { type: 'text', value: s.note, placeholder: 'What did you work on?', maxLength: 500, className: 'session-note' });
      note.setAttribute('aria-label', `What you worked on, ${clock(s.start)}`);
      note.addEventListener('change', () => api.updateSessionNote(s.id, note.value.trim()));
      note.addEventListener('keydown', (e) => { if (e.key === 'Enter') note.blur(); });
      const meta = make('span', {
        className: 'session-meta',
        textContent: `${clock(s.start)}–${clock(s.end)} · ${duration(s.workedSec)}${s.completed ? '' : ' · stopped early'}`,
      });
      return make('li', {}, [meta, note]);
    });
    goals.forEach((g) => items.push(make('li', { className: 'goal-reached', textContent: `✓ Goal reached: ${g.title}` })));
    $('cal-day-list').replaceChildren(...items);
    $('cal-day-empty').classList.toggle('hidden', items.length > 0);
  }

  $('cal-prev').addEventListener('click', () => {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
    loadMonth();
  });
  $('cal-next').addEventListener('click', () => {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
    loadMonth();
  });

  window.addEventListener('session-recorded', () => {
    if (activeTab === 'calendar') loadMonth();
  });

  // ---- Google Calendar ----

  function renderGcal(status) {
    const text = $('gcal-status');
    let message;
    if (status.error) message = status.error;
    else if (status.connecting) message = 'Finish signing in in your browser…';
    else if (status.connected) {
      message = `Connected. Focus sessions and reached goals sync to the "${status.calendarName}" calendar.`;
      if (status.lastSyncAt) message += ` Last synced ${clock(status.lastSyncAt)}.`;
      if (!status.persistent) message += ' This system can\'t store the sign-in securely, so you\'ll need to connect again after restarting.';
    } else if (status.configured) message = 'Not connected. Click Connect to sign in with Google.';
    else message = 'Not set up yet. Follow the steps below.';
    text.textContent = message;
    text.classList.toggle('error', !!status.error);

    $('gcal-setup').classList.toggle('hidden', status.connected);
    if (document.activeElement !== $('gcal-client-id')) $('gcal-client-id').value = status.clientId;
    $('gcal-client-secret').placeholder = status.configured ? 'saved' : '';
    $('gcal-connect-btn').classList.toggle('hidden', status.connected);
    $('gcal-connect-btn').disabled = status.connecting;
    $('gcal-sync-btn').classList.toggle('hidden', !status.connected);
    $('gcal-disconnect-btn').classList.toggle('hidden', !status.connected);
  }

  $('gcal-connect-btn').addEventListener('click', async () => {
    const clientId = $('gcal-client-id').value.trim();
    const clientSecret = $('gcal-client-secret').value.trim();
    if (clientId || clientSecret) renderGcal(await api.saveGcalClient(clientId, clientSecret));
    $('gcal-client-secret').value = '';
    renderGcal(await api.connectGcal());
  });
  $('gcal-sync-btn').addEventListener('click', async () => renderGcal(await api.syncGcalNow()));
  $('gcal-disconnect-btn').addEventListener('click', async () => renderGcal(await api.disconnectGcal()));

  api.onGcalStatus(renderGcal);
  api.getGcalStatus().then(renderGcal);
})();
