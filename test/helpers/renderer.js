const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../renderer/renderer.js'), 'utf8');

function createRenderer(overrides = {}) {
  let wall = 1_800_000_000_000;
  let mono = 1_000;
  let interval = null;
  const calls = { sessions: [], settings: [], goals: 0, progress: [] };
  const listeners = new Map();

  function element() {
    const handlers = new Map();
    const attrs = new Map();
    const classes = new Set(['hidden']);
    const node = {
      value: '', checked: false, textContent: '', title: '', disabled: false,
      dataset: {}, children: [], options: [], style: {
        setProperty(name, value) { this[name] = value; },
        removeProperty(name) { delete this[name]; },
        getPropertyValue(name) { return this[name] || ''; },
      },
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          const on = force === undefined ? !classes.has(name) : force;
          if (on) classes.add(name); else classes.delete(name);
          return on;
        },
      },
      addEventListener(name, handler) {
        const list = handlers.get(name) || [];
        list.push(handler);
        handlers.set(name, list);
      },
      dispatchEvent(event) {
        for (const handler of handlers.get(event.type) || []) handler(event);
      },
      setAttribute(name, value) { attrs.set(name, value); },
      getAttribute(name) { return attrs.get(name); },
      querySelector() { return element(); },
      appendChild(child) { this.children.push(child); this.options.push(child); },
      replaceChildren(...items) { this.children = items; },
      getBoundingClientRect() { return { width: 100, height: 100, top: 0, bottom: 100, left: 0 }; },
      remove() {}, focus() {}, blur() {},
      get previousElementSibling() { return element(); },
      get selectedOptions() { return this.options.filter((item) => item.value === this.value); },
    };
    return node;
  }

  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  for (const [id, min, max, value] of [
    ['work-min', 1, 180, 25], ['break-min', 1, 60, 5],
    ['long-break-min', 1, 60, 15], ['long-break-every', 2, 12, 4],
  ]) Object.assign(get(id), { min: String(min), max: String(max), value: String(value) });
  get('gauge-style').options = [Object.assign(element(), { value: 'pie', textContent: 'Filled pie' })];
  get('gauge-style').value = 'pie';

  const settings = {
    workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4,
    autoStartBreaks: false, autoStartFocus: false, notifyOnPhaseChange: false,
    alwaysOnTop: false, minimizeToTray: false, closeToTray: false,
    backgroundBlur: 0, backgroundTintColor: '#000000', backgroundTintOpacity: 0,
    accentColor: '#f2405a', gaugeStyle: 'pie', panelSplit: 0.48,
    currentTask: '', totalTurns: 0, totalStudySeconds: 0, sizeLocked: false,
  };
  Object.assign(settings, overrides.settings || {});
  let goals = overrides.goals || [];
  const pomodoro = {
    getSettings: async () => settings,
    getBackgroundImage: async () => null,
    getVersion: async () => '0.2.0',
    getDisplays: async () => [],
    hasAnyRecords: async () => false,
    listGoals: async () => { calls.goals++; return goals; },
    saveSettings: async (value) => { calls.settings.push(value); },
    addSession: async (record) => { calls.sessions.push(record); if (overrides.addSession) return overrides.addSession(record); },
    setProgress: (...args) => calls.progress.push(args),
    onSuspend: (handler) => { pomodoro.suspend = handler; },
    onPrepareQuit: (handler) => { pomodoro.prepareQuit = handler; },
    onFullscreenChange() {}, onPointerInside() {},
    closeNotification() {},
    resetConfig: async () => ({ ...settings, workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 }),
    ...overrides.pomodoro,
  };
  const window = {
    pomodoro, innerWidth: 800, innerHeight: 600,
    addEventListener(name, handler) {
      const list = listeners.get(name) || [];
      list.push(handler);
      listeners.set(name, list);
    },
    dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); },
  };
  const document = {
    documentElement: element(), body: element(),
    getElementById: get,
    querySelectorAll: () => [],
    createElement: () => element(),
    addEventListener() {},
  };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [wall])); }
    static now() { return wall; }
  }
  vm.runInNewContext(source, {
    window, document, Date: FakeDate, performance: { now: () => mono },
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setInterval: (handler) => { interval = handler; return 1; },
    clearInterval: () => { interval = null; },
    getComputedStyle: (node) => node.style,
    Image: class {},
  });
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return {
    get, window, pomodoro, calls, flush,
    emit(id, type) { get(id).dispatchEvent({ type }); },
    advance(ms, wallMs = ms, tick = true) { mono += ms; wall += wallMs; if (tick && interval) interval(); },
    shiftWall(ms) { wall += ms; },
    setGoals(value) { goals = value; window.dispatchEvent({ type: 'goals-changed' }); },
  };
}

module.exports = { createRenderer };
