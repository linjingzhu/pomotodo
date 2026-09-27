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
    if (name === 'goals') { loadGoals(); startClock(); } else { stopClock(); }
    if (name === 'calendar') loadMonth();
  }

  tabs.forEach((t) => $(`tab-btn-${t}`).addEventListener('click', () => showTab(t)));

  window.addEventListener('panel-toggled', (e) => {
    if (e.detail) showTab(activeTab);
    else stopClock(); // the panel (and its clock) is no longer visible
  });

  // ---- live clock (Goals tab) ----

  const TIME_ZONES = [
    ['', 'Local'],
    ['UTC', 'UTC'],
    ['Asia/Seoul', 'KST (Seoul)'],
    ['Asia/Tokyo', 'JST (Tokyo)'],
    ['America/Los_Angeles', 'PT (Los Angeles)'],
    ['America/New_York', 'ET (New York)'],
    ['Europe/London', 'GMT (London)'],
    ['Europe/Paris', 'CET (Paris)'],
    ['Asia/Kolkata', 'IST (India)'],
    ['Australia/Sydney', 'AEST (Sydney)'],
  ];
  let clockTimeZone = '';
  let clockTimer = null;

  function renderClock() {
    const opts = clockTimeZone ? { timeZone: clockTimeZone } : {};
    const now = new Date();
    $('goal-clock-date').textContent = now.toLocaleDateString('en-US', { ...opts, weekday: 'short', month: 'short', day: 'numeric' });
    $('goal-clock-time').textContent = now.toLocaleTimeString('en-GB', { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  function startClock() {
    renderClock();
    if (!clockTimer) clockTimer = setInterval(renderClock, 1000);
  }
  function stopClock() {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  }

  const tzSelect = $('goal-clock-tz');
  TIME_ZONES.forEach(([value, label]) => tzSelect.appendChild(make('option', { value, textContent: label })));
  const tzDropdown = window.makeDropdown(tzSelect);
  tzSelect.addEventListener('change', () => {
    clockTimeZone = tzSelect.value;
    api.saveSettings({ clockTimeZone });
    renderClock();
  });
  api.getSettings().then((settings) => {
    clockTimeZone = settings.clockTimeZone || '';
    tzSelect.value = clockTimeZone;
    tzDropdown.refresh();
    renderClock();
  });

  // ---- goals ----

  let dragGoalId = null;

  function clearDropMarkers() {
    document.querySelectorAll('.drop-before, .drop-after, .drop-target')
      .forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-target'));
  }

  // Every drop - onto a goal, a group header, or a list's empty space -
  // goes through here: file it into that group (a no-op if it's already
  // there), then place it (or leave it at the end when beforeId is null).
  async function handleDrop(id, groupId, beforeId) {
    await api.setGoalGroup(id, groupId);
    await api.reorderGoal(id, beforeId);
    window.dispatchEvent(new Event('goals-changed'));
  }

  async function loadGoals() {
    const [goals, groups] = await Promise.all([api.listGoals(), api.listGroups()]);
    renderGoalSections(goals, groups);
  }

  function goalRow(goal) {
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

    const rename = make('button', { className: 'goal-rename', textContent: '✎', title: 'Rename goal' });
    rename.setAttribute('aria-label', `Rename goal: ${goal.title}`);
    rename.addEventListener('click', (e) => {
      e.stopPropagation();
      const input = make('input', { type: 'text', maxLength: 200, value: goal.title, className: 'rename-input' });
      title.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const commit = async () => {
        if (done) return;
        done = true;
        const text = input.value.trim();
        if (text && text !== goal.title) await api.renameGoal(goal.id, text);
        window.dispatchEvent(new Event('goals-changed'));
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') input.blur();
        else if (ev.key === 'Escape') { done = true; window.dispatchEvent(new Event('goals-changed')); }
      });
      input.addEventListener('blur', commit);
    });

    const classes = [goal.doneAt ? 'done' : '', current ? 'current' : ''].filter(Boolean).join(' ');
    const li = make('li', { className: classes }, [check, title, when, rename, remove]);
    li.dataset.goalId = goal.id;

    // Only open goals can be dragged; reached ones are a static history.
    if (!goal.doneAt) {
      li.draggable = true;
      li.addEventListener('dragstart', (e) => {
        dragGoalId = goal.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', goal.id);
      });
      li.addEventListener('dragend', () => { dragGoalId = null; clearDropMarkers(); });
      li.addEventListener('dragover', (e) => {
        if (!dragGoalId || dragGoalId === goal.id) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = li.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        clearDropMarkers();
        li.classList.add(before ? 'drop-before' : 'drop-after');
      });
      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = dragGoalId;
        const before = li.classList.contains('drop-before');
        const groupId = li.closest('.goal-section').dataset.groupId || null;
        clearDropMarkers();
        if (!id || id === goal.id) return;
        const beforeId = before ? goal.id : (li.nextElementSibling ? li.nextElementSibling.dataset.goalId : null);
        await handleDrop(id, groupId, beforeId);
      });
    }
    return li;
  }

  function groupSection(groupId, name, openGoals, editable) {
    const titleEl = make(editable ? 'span' : 'h4', { className: 'goal-section-title', textContent: name });
    const header = make('div', { className: 'goal-section-header' }, [titleEl]);
    if (editable) {
      const rename = make('button', { className: 'goal-rename', textContent: '✎', title: 'Rename group' });
      rename.addEventListener('click', () => {
        const input = make('input', { type: 'text', maxLength: 60, value: name, className: 'rename-input' });
        titleEl.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const commit = async () => {
          if (done) return;
          done = true;
          const text = input.value.trim();
          if (text && text !== name) await api.renameGroup(groupId, text);
          window.dispatchEvent(new Event('goals-changed'));
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
          else if (e.key === 'Escape') { done = true; window.dispatchEvent(new Event('goals-changed')); }
        });
        input.addEventListener('blur', commit);
      });
      const remove = make('button', { className: 'goal-delete', textContent: '×', title: 'Delete group (its goals stay, ungrouped)' });
      remove.addEventListener('click', async () => {
        await api.deleteGroup(groupId);
        window.dispatchEvent(new Event('goals-changed'));
      });
      header.append(rename, remove);
    }
    // Dropping a goal onto a header files it into this group, at the end.
    header.addEventListener('dragover', (e) => { if (dragGoalId) { e.preventDefault(); header.classList.add('drop-target'); } });
    header.addEventListener('dragleave', () => header.classList.remove('drop-target'));
    header.addEventListener('drop', async (e) => {
      e.preventDefault();
      const id = dragGoalId;
      clearDropMarkers();
      if (!id) return;
      await handleDrop(id, groupId, null);
    });

    const list = make('ul', { className: 'goal-list' }, openGoals.map(goalRow));
    // A drop on the list's own empty space (not a goal row) also files
    // it here, at the end - the row-level handler already covers drops
    // on a specific row.
    list.addEventListener('dragover', (e) => { if (dragGoalId && e.target === list) e.preventDefault(); });
    list.addEventListener('drop', async (e) => {
      if (e.target !== list) return;
      e.preventDefault();
      const id = dragGoalId;
      clearDropMarkers();
      if (!id) return;
      await handleDrop(id, groupId, null);
    });

    const form = make('form', { className: 'goal-add-form' });
    const input = make('input', { type: 'text', maxLength: 200, placeholder: 'Add a goal', className: 'goal-add-input' });
    form.append(input, make('button', { type: 'submit', className: 'goal-add-btn', textContent: 'Add' }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      await api.addGoal(input.value, groupId);
      input.value = '';
      window.dispatchEvent(new Event('goals-changed'));
    });

    const section = make('div', { className: 'goal-section' }, [header, form, list]);
    section.dataset.groupId = groupId || '';
    return section;
  }

  function renderGoalSections(goals, groups) {
    const openByGroup = new Map([[null, []]]);
    groups.forEach((g) => openByGroup.set(g.id, []));
    const done = [];
    goals.forEach((g) => {
      if (g.doneAt) { done.push(g); return; }
      (openByGroup.has(g.groupId) ? openByGroup.get(g.groupId) : openByGroup.get(null)).push(g);
    });

    const sections = [groupSection(null, 'Goals', openByGroup.get(null), false)];
    groups.forEach((g) => sections.push(groupSection(g.id, g.name, openByGroup.get(g.id), true)));
    if (done.length) {
      const header = make('div', { className: 'goal-section-header' }, [make('h4', { className: 'goal-section-title', textContent: 'Reached' })]);
      sections.push(make('div', { className: 'goal-section' }, [header, make('ul', { className: 'goal-list' }, done.map(goalRow))]));
    }
    $('goal-sections').replaceChildren(...sections);
    $('goals-empty').classList.toggle('hidden', goals.length > 0);
  }

  $('add-group-btn').addEventListener('click', () => {
    const addBtn = $('add-group-btn');
    const input = make('input', { type: 'text', maxLength: 60, placeholder: 'Group name', className: 'rename-input' });
    addBtn.replaceWith(input);
    input.focus();
    let done = false;
    const cancel = () => { if (done) return; done = true; input.replaceWith(addBtn); };
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (!text) { cancel(); return; }
        done = true;
        await api.addGroup(text);
        window.dispatchEvent(new Event('goals-changed'));
        input.replaceWith(addBtn);
      } else if (e.key === 'Escape') {
        cancel();
      }
    });
    input.addEventListener('blur', () => setTimeout(cancel, 150));
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
