const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../store');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-store-')), 'records.json');
}

test('sessions are saved, listed by local month, and noted', () => {
  const file = tempFile();
  const s = store.addSession(file, { start: '2026-09-26T01:00:00.000Z', end: '2026-09-26T01:25:00.000Z', workedSec: 1500, note: 'essay', completed: true });
  assert.ok(s.id);
  const month = store.localDay(s.start).slice(0, 7);
  assert.deepStrictEqual(store.monthRecords(file, month).sessions.map((x) => x.note), ['essay']);
  assert.strictEqual(store.monthRecords(file, '1999-01').sessions.length, 0);
  assert.strictEqual(store.updateSession(file, s.id, { note: 'essay draft' }).note, 'essay draft');
  assert.strictEqual(store.updateSession(file, 'missing', { note: 'x' }), null);
});

test('goals: add, reach, un-reach, order, delete', () => {
  const file = tempFile();
  assert.strictEqual(store.addGoal(file, '   '), null);
  const a = store.addGoal(file, 'Read chapter 3');
  const b = store.addGoal(file, 'Finish problem set');
  store.setGoalDone(file, a.id, true);
  const listed = store.listGoals(file);
  assert.deepStrictEqual(listed.map((g) => g.title), ['Finish problem set', 'Read chapter 3']);
  assert.ok(listed[1].doneAt);
  const month = store.localDay(listed[1].doneAt).slice(0, 7);
  assert.deepStrictEqual(store.monthRecords(file, month).goalsDone.map((g) => g.id), [a.id]);
  assert.strictEqual(store.setGoalDone(file, a.id, false).doneAt, null);
  assert.strictEqual(store.deleteGoal(file, b.id).id, b.id);
  assert.deepStrictEqual(store.listGoals(file).map((g) => g.id), [a.id]);
});

test('pending sync covers unsynced sessions and reached goals only', () => {
  const file = tempFile();
  const s1 = store.addSession(file, { start: new Date().toISOString(), end: new Date().toISOString(), workedSec: 60, note: '', completed: false });
  store.addSession(file, { start: new Date().toISOString(), end: new Date().toISOString(), workedSec: 60, note: '', completed: true });
  const open = store.addGoal(file, 'open');
  const reached = store.addGoal(file, 'reached');
  store.setGoalDone(file, reached.id, true);
  store.updateSession(file, s1.id, { gcalEventId: 'evt1' });

  let pending = store.pendingSync(file);
  assert.strictEqual(pending.sessions.length, 1);
  assert.deepStrictEqual(pending.goals.map((g) => g.id), [reached.id]);
  assert.ok(!pending.goals.some((g) => g.id === open.id));

  store.clearEventIds(file);
  pending = store.pendingSync(file);
  assert.strictEqual(pending.sessions.length, 2);
});

test('a missing or corrupt file reads as empty', () => {
  const file = tempFile();
  assert.deepStrictEqual(store.load(file), { sessions: [], goals: [] });
  fs.writeFileSync(file, '{not json');
  assert.deepStrictEqual(store.load(file), { sessions: [], goals: [] });
});
