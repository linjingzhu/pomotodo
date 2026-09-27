// Focus-session history and goals, kept in one JSON file next to
// settings.json. Plain functions over a file path so they can be tested
// without Electron.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function emptyStore() {
  return { sessions: [], goals: [] };
}

function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return { sessions: data.sessions || [], goals: data.goals || [] };
  } catch (e) {
    return emptyStore();
  }
}

function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function update(file, fn) {
  const data = load(file);
  const result = fn(data);
  save(file, data);
  return result;
}

// Local calendar day (YYYY-MM-DD) of an ISO timestamp.
function localDay(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addSession(file, { start, end, workedSec, note, completed }) {
  const session = {
    id: crypto.randomUUID(),
    start,
    end,
    workedSec: Math.max(0, Math.round(workedSec)),
    note: String(note || '').slice(0, 500),
    completed: !!completed,
  };
  update(file, (data) => data.sessions.push(session));
  return session;
}

function updateSession(file, id, patch) {
  return update(file, (data) => {
    const session = data.sessions.find((s) => s.id === id);
    if (!session) return null;
    if ('note' in patch) session.note = String(patch.note || '').slice(0, 500);
    return { ...session };
  });
}

function deleteSession(file, id) {
  return update(file, (data) => {
    const i = data.sessions.findIndex((s) => s.id === id);
    return i === -1 ? null : data.sessions.splice(i, 1)[0];
  });
}

// `month` is 'YYYY-MM' in local time.
function monthRecords(file, month) {
  const data = load(file);
  return {
    sessions: data.sessions.filter((s) => localDay(s.start).startsWith(month)),
    goalsDone: data.goals.filter((g) => g.doneAt && localDay(g.doneAt).startsWith(month)),
  };
}

function listGoals(file) {
  const goals = load(file).goals;
  // open goals first (newest first), then finished ones (latest first)
  return [
    ...goals.filter((g) => !g.doneAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    ...goals.filter((g) => g.doneAt).sort((a, b) => b.doneAt.localeCompare(a.doneAt)),
  ];
}

function addGoal(file, title) {
  const text = String(title || '').trim().slice(0, 200);
  if (!text) return null;
  return update(file, (data) => {
    // an open goal with the same title (any case) is reused, not duplicated
    const existing = data.goals.find((g) => !g.doneAt && g.title.toLowerCase() === text.toLowerCase());
    if (existing) return { ...existing };
    const goal = { id: crypto.randomUUID(), title: text, createdAt: new Date().toISOString(), doneAt: null };
    data.goals.push(goal);
    return goal;
  });
}

function setGoalDone(file, id, done) {
  return update(file, (data) => {
    const goal = data.goals.find((g) => g.id === id);
    if (!goal) return null;
    goal.doneAt = done ? new Date().toISOString() : null;
    return { ...goal };
  });
}

function deleteGoal(file, id) {
  return update(file, (data) => {
    const i = data.goals.findIndex((g) => g.id === id);
    return i === -1 ? null : data.goals.splice(i, 1)[0];
  });
}

function hasAnyRecords(file) {
  const data = load(file);
  return data.sessions.length > 0 || data.goals.length > 0;
}

// Wipes every session and goal (the Data section's "reset all records").
// Settings (settings.json) are untouched; see resetConfig in main.js.
function resetAllRecords(file) {
  update(file, (data) => {
    data.sessions = [];
    data.goals = [];
  });
}

module.exports = {
  load,
  localDay,
  addSession,
  updateSession,
  deleteSession,
  monthRecords,
  listGoals,
  addGoal,
  setGoalDone,
  deleteGoal,
  hasAnyRecords,
  resetAllRecords,
};
