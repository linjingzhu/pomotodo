// The expandable panel: Goals, Calendar (daily history, kept on this PC
// only) and Settings tabs.
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
      window.dispatchEvent(new Event('goals-changed')); // reloads this list too
    });
    const when = goal.doneAt
      ? make('span', { className: 'goal-date', textContent: `reached ${new Date(goal.doneAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` })
      : '';
    const remove = make('button', { className: 'goal-delete', textContent: '×', title: 'Delete goal' });
    remove.setAttribute('aria-label', `Delete goal: ${goal.title}`);
    remove.addEventListener('click', async () => {
      await api.deleteGoal(goal.id);
      window.dispatchEvent(new Event('goals-changed'));
    });
    const current = $('task-input').value.trim().toLowerCase() === goal.title.toLowerCase();
    const title = make('span', {
      className: 'goal-title',
      textContent: goal.title,
      tabIndex: 0,
      title: current ? 'Current goal on the timer' : 'Set as the timer\'s goal',
    });
    title.setAttribute('role', 'button');
    const select = () => {
      $('task-input').value = goal.title;
      $('task-input').dispatchEvent(new Event('change'));
    };
    title.addEventListener('click', select);
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    });
    const classes = [goal.doneAt ? 'done' : '', current ? 'current' : ''].filter(Boolean).join(' ');
    return make('li', { className: classes }, [check, title, when, remove]);
  }

  $('goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('goal-input');
    if (!input.value.trim()) return;
    await api.addGoal(input.value);
    input.value = '';
    window.dispatchEvent(new Event('goals-changed'));
  });

  // ---- calendar ----

  const today = new Date();
  let viewMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let selectedDay = dayKey(today);
  let monthData = { sessions: [], goalsDone: [] };

  // Level 0 is under an hour of focus that day (no color); each further
  // hour is one darker step, capped at the 4th (4h or more).
  function level(sec) {
    return Math.min(4, Math.floor(Math.max(0, sec) / 3600));
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

    const cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => make('span', { className: 'cal-weekday', textContent: d }));
    for (let i = 0; i < viewMonth.getDay(); i++) cells.push(make('span'));
    const days = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const key = dayKey(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
      const sec = perDay[key] || 0;
      const cell = make('button', { className: `cal-day level-${level(sec)}`, textContent: String(d) });
      if (key === dayKey(today)) cell.classList.add('today');
      if (key === selectedDay) cell.classList.add('selected');
      const date = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      cell.title = sec ? `${date} · ${duration(sec)} of focus` : `${date} · No focus sessions`;
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
      const remove = make('button', { className: 'row-delete', textContent: '×', title: 'Delete this session' });
      remove.setAttribute('aria-label', `Delete session, ${clock(s.start)}`);
      remove.addEventListener('click', async () => {
        await api.deleteSession(s.id);
        loadMonth();
      });
      return make('li', {}, [make('div', { className: 'session-meta-row' }, [meta, remove]), note]);
    });
    goals.forEach((g) => {
      const label = make('span', { className: 'goal-reached', textContent: `✓ Goal reached: ${g.title}` });
      const remove = make('button', { className: 'row-delete', textContent: '×', title: 'Delete goal' });
      remove.setAttribute('aria-label', `Delete goal: ${g.title}`);
      remove.addEventListener('click', async () => {
        await api.deleteGoal(g.id);
        window.dispatchEvent(new Event('goals-changed')); // reloads this list too
      });
      items.push(make('li', { className: 'goal-reached-row' }, [label, remove]));
    });
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

  // Keep the list in step with the timer's goal field (and the calendar,
  // which lists reached goals, with goal changes).
  ['goals-changed', 'task-changed'].forEach((name) => window.addEventListener(name, () => {
    if (activeTab === 'goals') loadGoals();
    if (activeTab === 'calendar' && name === 'goals-changed') loadMonth();
  }));

  window.addEventListener('session-recorded', () => {
    if (activeTab === 'calendar') loadMonth();
  });
})();
