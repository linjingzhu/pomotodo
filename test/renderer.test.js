const test = require('node:test');
const assert = require('node:assert/strict');
const { createRenderer } = require('./helpers/renderer');

test('wall-clock adjustments do not change remaining time or credited focus', async () => {
  const app = createRenderer();
  await app.flush();
  app.emit('start-pause-btn', 'click');
  app.advance(30_000);
  assert.equal(app.get('timer-display').textContent, '24:30');
  app.shiftWall(-3_600_000);
  app.advance(30_000, 0);
  assert.equal(app.get('timer-display').textContent, '24:00');
  await app.pomodoro.prepareQuit();
  assert.equal(app.calls.sessions.length, 1);
  assert.equal(app.calls.sessions[0].workedSec, 60);
});

test('late suspend callback pauses without counting the sleep gap', async () => {
  const app = createRenderer();
  await app.flush();
  app.emit('start-pause-btn', 'click');
  app.advance(40_000);
  app.advance(300_000, 300_000, false);
  app.pomodoro.suspend();
  assert.equal(app.get('timer-display').textContent, '24:20');
  assert.equal(app.get('app').dataset.state, 'paused');
  assert.equal(app.calls.settings.some((value) => value.totalStudySeconds === 340), false);
});

test('suspend also excludes a short sleep before the next timer callback', async () => {
  const app = createRenderer();
  await app.flush();
  app.emit('start-pause-btn', 'click');
  app.advance(40_000);
  app.advance(30_000, 30_000, false);
  app.pomodoro.suspend();
  assert.equal(app.get('timer-display').textContent, '24:20');
  assert.equal(app.get('app').dataset.state, 'paused');
});

test('natural completion credits one phase and prepares a full idle break', async () => {
  const app = createRenderer({ settings: { workMinutes: 1 } });
  await app.flush();
  app.emit('start-pause-btn', 'click');
  app.advance(61_000);
  await app.flush();
  assert.equal(app.calls.sessions.length, 1);
  assert.equal(app.calls.sessions[0].workedSec, 60);
  assert.equal(app.calls.sessions[0].completed, true);
  assert.equal(Date.parse(app.calls.sessions[0].end) - Date.parse(app.calls.sessions[0].start), 60_000);
  assert.equal(app.get('timer-display').textContent, '05:00');
  assert.equal(app.get('app').dataset.state, 'idle');
});

test('duration edits keep an active phase fixed and normalize the next idle phase', async () => {
  const app = createRenderer();
  await app.flush();
  app.emit('start-pause-btn', 'click');
  app.advance(60_000);
  app.get('work-min').value = '999';
  app.emit('work-min', 'change');
  assert.equal(app.get('work-min').value, 180);
  assert.equal(app.get('timer-display').textContent, '24:00');
  app.advance(30_000);
  assert.equal(app.get('timer-display').textContent, '23:30');
  const progress = app.calls.progress.at(-1)[1];
  assert.equal(progress, 0.06);
  app.emit('start-pause-btn', 'click');
  app.get('work-min').value = '20';
  app.emit('work-min', 'change');
  assert.equal(app.get('timer-display').textContent, '23:30');
  assert.equal(app.get('app').dataset.state, 'paused');
});

test('configuration reset preserves a paused countdown', async () => {
  const app = createRenderer();
  await app.flush();
  app.emit('start-pause-btn', 'click');
  app.advance(90_000);
  app.emit('start-pause-btn', 'click');
  app.emit('reset-config-btn', 'click');
  await app.flush();
  assert.equal(app.get('timer-display').textContent, '23:30');
  assert.equal(app.get('app').dataset.state, 'paused');
});

test('typing uses cached goals until a goals-changed event', async () => {
  const app = createRenderer({ goals: [{ id: 1, title: 'Read', doneAt: null }] });
  await app.flush();
  const initial = app.calls.goals;
  app.get('task-input').value = 'Read';
  for (let i = 0; i < 20; i++) app.emit('task-input', 'input');
  await app.flush();
  assert.equal(app.calls.goals, initial);
  app.setGoals([{ id: 1, title: 'Read', doneAt: '2026-01-01' }]);
  await app.flush();
  assert.equal(app.calls.goals, initial + 1);
  assert.equal(app.get('goal-check').getAttribute('aria-checked'), 'true');
});

test('quit saves one ongoing session and retries a failed write', async () => {
  let fail = true;
  const app = createRenderer({ addSession: async () => { if (fail) throw new Error('disk error'); } });
  await app.flush();
  app.emit('start-pause-btn', 'click');
  app.advance(65_000);
  await assert.rejects(app.pomodoro.prepareQuit(), /disk error/);
  assert.equal(app.calls.sessions.length, 1);
  fail = false;
  await app.pomodoro.prepareQuit();
  assert.equal(app.calls.sessions.length, 2);
  assert.deepEqual(app.calls.sessions[0], app.calls.sessions[1]);
  assert.equal(app.calls.settings.at(-1).totalStudySeconds, 65);
  await app.pomodoro.prepareQuit();
  assert.equal(app.calls.sessions.length, 2);
});

test('the close button asks main to close instead of calling window.close()', async () => {
  let closes = 0;
  const app = createRenderer({ pomodoro: { closeWindow: () => { closes++; } } });
  await app.flush();
  app.emit('close-btn', 'click');
  assert.equal(closes, 1);
});
