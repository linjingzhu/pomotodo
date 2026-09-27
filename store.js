// Focus-session history and goals, kept in one JSON file next to
// settings.json. Plain functions over a file path so they can be tested
// without Electron.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function emptyStore() {
  return { sessions: [], goals: [], groups: [] };
}

function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return { sessions: data.sessions || [], goals: data.goals || [], groups: data.groups || [] };
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

// Open goals: manual order (array position - see reorderGoal), newest
// first until dragged. Finished goals: unaffected by dragging, latest
// reached first.
function listGoals(file) {
  const goals = load(file).goals;
  return [
    ...goals.filter((g) => !g.doneAt),
    ...goals.filter((g) => g.doneAt).sort((a, b) => b.doneAt.localeCompare(a.doneAt)),
  ];
}

function addGoal(file, title, groupId = null) {
  const text = String(title || '').trim().slice(0, 200);
  if (!text) return null;
  return update(file, (data) => {
    // an open goal with the same title (any case) is reused, not
    // duplicated, wherever it already is - never moved to a new group.
    const existing = data.goals.find((g) => !g.doneAt && g.title.toLowerCase() === text.toLowerCase());
    if (existing) return { ...existing };
    const goal = {
      id: crypto.randomUUID(),
      title: text,
      createdAt: new Date().toISOString(),
      doneAt: null,
      groupId: data.groups.some((g) => g.id === groupId) ? groupId : null,
    };
    data.goals.unshift(goal); // newest first, until manually reordered
    return goal;
  });
}

function renameGoal(file, id, title) {
  const text = String(title || '').trim().slice(0, 200);
  if (!text) return null;
  return update(file, (data) => {
    const goal = data.goals.find((g) => g.id === id);
    if (!goal) return null;
    goal.title = text;
    return { ...goal };
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

// Moves a goal to just before `beforeId` (another goal's id), or to the
// end of the list when beforeId is null/not found. Array position is
// the whole ordering mechanism (see listGoals); the renderer only ever
// passes a beforeId from the same group's open-goal section, so this
// never needs to know about groups itself.
// Files a goal under a different group (or ungroups it with a falsy
// groupId), used when a goal is dropped onto a group's header. An
// unknown groupId is rejected (returns null) rather than silently
// ungrouping, so a stale id from the renderer never surprises the user.
function setGoalGroup(file, id, groupId) {
  return update(file, (data) => {
    const goal = data.goals.find((g) => g.id === id);
    if (!goal) return null;
    if (groupId && !data.groups.some((g) => g.id === groupId)) return null;
    goal.groupId = groupId || null;
    return { ...goal };
  });
}

function reorderGoal(file, id, beforeId) {
  return update(file, (data) => {
    const from = data.goals.findIndex((g) => g.id === id);
    if (from === -1) return null;
    const [goal] = data.goals.splice(from, 1);
    const to = beforeId ? data.goals.findIndex((g) => g.id === beforeId) : -1;
    data.goals.splice(to === -1 ? data.goals.length : to, 0, goal);
    return { ...goal };
  });
}

function listGroups(file) {
  return load(file).groups;
}

function addGroup(file, name) {
  const text = String(name || '').trim().slice(0, 60);
  if (!text) return null;
  return update(file, (data) => {
    const group = { id: crypto.randomUUID(), name: text, createdAt: new Date().toISOString() };
    data.groups.push(group);
    return group;
  });
}

function renameGroup(file, id, name) {
  const text = String(name || '').trim().slice(0, 60);
  if (!text) return null;
  return update(file, (data) => {
    const group = data.groups.find((g) => g.id === id);
    if (!group) return null;
    group.name = text;
    return { ...group };
  });
}

// Deleting a group leaves its member goals in place, ungrouped.
function deleteGroup(file, id) {
  return update(file, (data) => {
    const i = data.groups.findIndex((g) => g.id === id);
    if (i === -1) return null;
    const [group] = data.groups.splice(i, 1);
    data.goals.forEach((g) => { if (g.groupId === id) g.groupId = null; });
    return group;
  });
}

function hasAnyRecords(file) {
  const data = load(file);
  return data.sessions.length > 0 || data.goals.length > 0 || data.groups.length > 0;
}

// Wipes every session, goal and group (the Data section's "reset all
// records"). Settings (settings.json) are untouched; see resetConfig in
// main.js.
function resetAllRecords(file) {
  update(file, (data) => {
    data.sessions = [];
    data.goals = [];
    data.groups = [];
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
  renameGoal,
  setGoalDone,
  deleteGoal,
  reorderGoal,
  setGoalGroup,
  listGroups,
  addGroup,
  renameGroup,
  deleteGroup,
  hasAnyRecords,
  resetAllRecords,
};
