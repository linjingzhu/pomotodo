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

test('a session can be deleted', () => {
  const file = tempFile();
  const a = store.addSession(file, { start: '2026-09-26T01:00:00.000Z', end: '2026-09-26T01:25:00.000Z', workedSec: 1500, note: 'a', completed: true });
  const b = store.addSession(file, { start: '2026-09-26T02:00:00.000Z', end: '2026-09-26T02:25:00.000Z', workedSec: 1500, note: 'b', completed: true });
  assert.strictEqual(store.deleteSession(file, a.id).id, a.id);
  const month = store.localDay(b.start).slice(0, 7);
  assert.deepStrictEqual(store.monthRecords(file, month).sessions.map((s) => s.id), [b.id]);
  assert.strictEqual(store.deleteSession(file, 'missing'), null);
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

test('adding an open goal that already exists (any case) reuses it', () => {
  const file = tempFile();
  const a = store.addGoal(file, 'Read chapter 5');
  assert.strictEqual(store.addGoal(file, '  read CHAPTER 5 ').id, a.id);
  assert.strictEqual(store.listGoals(file).length, 1);
  store.setGoalDone(file, a.id, true);
  assert.notStrictEqual(store.addGoal(file, 'Read chapter 5').id, a.id, 'a reached goal does not block a new one');
  assert.strictEqual(store.listGoals(file).length, 2);
});

test('a missing or corrupt file reads as empty', () => {
  const file = tempFile();
  assert.deepStrictEqual(store.load(file), { sessions: [], goals: [], groups: [] });
  fs.writeFileSync(file, '{not json');
  assert.deepStrictEqual(store.load(file), { sessions: [], goals: [], groups: [] });
});

test('mutations preserve corrupt or invalid records instead of silently replacing history', () => {
  const file = tempFile();
  for (const raw of ['{not json', 'null', '{"sessions":{}}', '{"goals":[null]}']) {
    fs.writeFileSync(file, raw);
    assert.throws(() => store.addGoal(file, 'Keep history'));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), raw);
  }
  store.resetAllRecords(file);
  assert.deepStrictEqual(store.load(file), { sessions: [], goals: [], groups: [] });
});

test('a self-drop keeps the goal order', () => {
  const file = tempFile();
  const a = store.addGoal(file, 'a');
  const b = store.addGoal(file, 'b');
  store.reorderGoal(file, b.id, b.id);
  assert.deepStrictEqual(store.listGoals(file).map((g) => g.id), [b.id, a.id]);
});

test('a goal can be renamed', () => {
  const file = tempFile();
  const a = store.addGoal(file, 'Read chapter 5');
  assert.strictEqual(store.renameGoal(file, a.id, '  Read chapter 6 ').title, 'Read chapter 6');
  assert.strictEqual(store.renameGoal(file, a.id, '   '), null, 'a blank name is rejected');
  assert.strictEqual(store.renameGoal(file, 'missing', 'x'), null);
  assert.strictEqual(store.listGoals(file)[0].title, 'Read chapter 6');
});

test('open goals can be manually reordered; done goals are unaffected', () => {
  const file = tempFile();
  const a = store.addGoal(file, 'a');
  const b = store.addGoal(file, 'b');
  const c = store.addGoal(file, 'c');
  assert.deepStrictEqual(store.listGoals(file).map((g) => g.title), ['c', 'b', 'a']);
  store.reorderGoal(file, a.id, b.id); // move a to just before b
  assert.deepStrictEqual(store.listGoals(file).map((g) => g.title), ['c', 'a', 'b']);
  store.reorderGoal(file, c.id, null); // move c to the end
  assert.deepStrictEqual(store.listGoals(file).map((g) => g.title), ['a', 'b', 'c']);
  assert.strictEqual(store.reorderGoal(file, 'missing', a.id), null);
});

test('groups: create, rename, delete (members become ungrouped)', () => {
  const file = tempFile();
  assert.strictEqual(store.addGroup(file, '  '), null);
  const work = store.addGroup(file, 'Work');
  store.addGroup(file, 'Personal');
  assert.deepStrictEqual(store.listGroups(file).map((g) => g.name), ['Work', 'Personal']);
  assert.strictEqual(store.renameGroup(file, work.id, ' Job ').name, 'Job');
  assert.strictEqual(store.renameGroup(file, 'missing', 'x'), null);

  const a = store.addGoal(file, 'Ship it', work.id);
  assert.strictEqual(a.groupId, work.id);
  const b = store.addGoal(file, 'No group here', 'not-a-real-group-id');
  assert.strictEqual(b.groupId, null, 'an unknown groupId falls back to ungrouped');

  assert.strictEqual(store.deleteGroup(file, work.id).id, work.id);
  assert.deepStrictEqual(store.listGroups(file).map((g) => g.name), ['Personal']);
  assert.strictEqual(store.listGoals(file).find((g) => g.id === a.id).groupId, null, 'its goal is now ungrouped, not deleted');
  assert.strictEqual(store.deleteGroup(file, 'missing'), null);
});

test('a goal can be filed into a different group by id, or ungrouped', () => {
  const file = tempFile();
  const work = store.addGroup(file, 'Work');
  const play = store.addGroup(file, 'Play');
  const a = store.addGoal(file, 'Ship it', work.id);
  assert.strictEqual(store.setGoalGroup(file, a.id, play.id).groupId, play.id);
  assert.strictEqual(store.setGoalGroup(file, a.id, null).groupId, null);
  assert.strictEqual(store.setGoalGroup(file, a.id, 'not-a-real-id'), null, 'an unknown group is rejected');
  assert.strictEqual(store.setGoalGroup(file, 'missing', work.id), null);
});

test('an unreadable records file keeps Reset All Records available', () => {
  const file = tempFile();
  fs.writeFileSync(file, '{"sessions": [');
  assert.equal(store.hasAnyRecords(file), true);
  assert.throws(() => store.addSession(file, { start: new Date().toISOString(), end: new Date().toISOString(), workedSec: 60 }));
  store.resetAllRecords(file);
  assert.equal(store.hasAnyRecords(file), false);
  store.addSession(file, { start: new Date().toISOString(), end: new Date().toISOString(), workedSec: 60 });
  assert.equal(store.hasAnyRecords(file), true);
});
