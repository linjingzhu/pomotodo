const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGcal, CalendarGoneError, nextDay, SCOPE } = require('../gcal');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// A fake Google: token endpoint (checks PKCE), revoke, and the Calendar API.
function fakeGoogle({ tokenExpiresIn = 3600 } = {}) {
  const g = { calls: [], calendars: new Set(), events: new Map(), challenge: null, refreshValid: true, failNext: null };
  g.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const body = opts.body || '';
    g.calls.push(`${opts.method || 'GET'} ${u.pathname}`);
    const json = (status, obj) => ({ ok: status < 300, status, json: async () => obj });
    if (u.href.startsWith('https://oauth2.googleapis.com/token')) {
      const p = new URLSearchParams(body);
      if (p.get('grant_type') === 'authorization_code') {
        const expected = b64url(crypto.createHash('sha256').update(p.get('code_verifier')).digest());
        if (p.get('code') !== 'the-code' || expected !== g.challenge) return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: tokenExpiresIn });
      }
      if (!g.refreshValid || p.get('refresh_token') !== 'rt-1') return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return json(200, { access_token: `at-${g.calls.length}`, expires_in: 3600 });
    }
    if (u.href.startsWith('https://oauth2.googleapis.com/revoke')) return json(200, {});
    if (g.failNext) {
      const status = g.failNext;
      g.failNext = null;
      return json(status, { error: { message: `forced ${status}` } });
    }
    const m = u.pathname.match(/^\/calendar\/v3\/calendars(?:\/([^/]+)(?:\/events(?:\/([^/]+))?)?)?$/);
    if (!m) return json(404, {});
    const [, calId, eventId] = m.map((x) => x && decodeURIComponent(x));
    if (!calId && opts.method === 'POST') {
      const id = `cal-${g.calendars.size + 1}`;
      g.calendars.add(id);
      return json(200, { id });
    }
    if (!g.calendars.has(calId)) return json(404, { error: { message: 'Not Found' } });
    if (opts.method === 'POST') {
      const id = `evt-${g.events.size + 1}`;
      g.events.set(id, { calId, ...JSON.parse(body) });
      return json(200, { id });
    }
    if (opts.method === 'DELETE') {
      if (!g.events.delete(eventId)) return json(410, {});
      return { ok: true, status: 204, json: async () => ({}) };
    }
    if (opts.method === 'PATCH') {
      Object.assign(g.events.get(eventId), JSON.parse(body));
      return json(200, {});
    }
    return json(404, {});
  };
  return g;
}

// Plays the user's browser: checks the consent URL, then hits the
// loopback redirect the way Google would.
function fakeBrowser(g, { tamperState = false, deny = false } = {}) {
  return async (authUrl) => {
    const u = new URL(authUrl);
    assert.strictEqual(u.searchParams.get('scope'), SCOPE);
    assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
    assert.strictEqual(u.searchParams.get('access_type'), 'offline');
    g.challenge = u.searchParams.get('code_challenge');
    const redirect = new URL(u.searchParams.get('redirect_uri'));
    assert.strictEqual(redirect.hostname, '127.0.0.1');
    const state = tamperState ? 'wrong' : u.searchParams.get('state');
    const query = deny ? `error=access_denied&state=${state}` : `code=the-code&state=${state}`;
    setTimeout(() => fetch(`${redirect.origin}/?${query}`).catch(() => {}), 10);
  };
}

function setup(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-gcal-'));
  const g = fakeGoogle(options);
  const statuses = [];
  const gcal = createGcal({
    configFile: path.join(dir, 'google-calendar.json'),
    openExternal: fakeBrowser(g, options),
    encrypt: options.noEncryption ? () => null : (t) => `enc:${t}`,
    decrypt: (s) => s.replace(/^enc:/, ''),
    fetchImpl: g.fetch,
    onStatus: (s) => statuses.push(s),
  });
  return { g, gcal, dir, statuses, configPath: path.join(dir, 'google-calendar.json') };
}

const session = { id: 's1', start: '2026-09-26T01:00:00.000Z', end: '2026-09-26T01:25:00.000Z', workedSec: 1500, note: 'essay', completed: true };

test('connect needs a client, then completes PKCE and stores the token encrypted', async () => {
  const { gcal, configPath } = setup();
  await assert.rejects(gcal.connect(), /client ID and secret/);
  gcal.saveClient({ clientId: 'cid', clientSecret: 'secret' });
  await gcal.connect();
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  assert.strictEqual(saved.refreshTokenEnc, 'enc:rt-1');
  assert.ok(!JSON.stringify(saved).includes('"rt-1"'), 'refresh token never stored in the clear');
  assert.deepStrictEqual({ ...gcal.status(), lastSyncAt: null }, {
    configured: true, clientId: 'cid', connected: true, connecting: false, persistent: true,
    calendarName: 'Pomodoro Timer', lastSyncAt: null, error: null,
  });
});

test('saving the client with a blank secret keeps the saved one', () => {
  const { gcal } = setup();
  gcal.saveClient({ clientId: 'cid', clientSecret: 'secret' });
  gcal.saveClient({ clientId: 'cid2', clientSecret: '' });
  assert.strictEqual(gcal.status().configured, true);
  assert.strictEqual(gcal.status().clientId, 'cid2');
});

test('a redirect with the wrong state or a denial is rejected', async () => {
  for (const opts of [{ tamperState: true }, { deny: true }]) {
    const { gcal } = setup(opts);
    gcal.saveClient({ clientId: 'cid', clientSecret: 'secret' });
    await assert.rejects(gcal.connect(), /did not complete|cancelled/);
    assert.strictEqual(gcal.status().connected, false);
    assert.strictEqual(gcal.status().connecting, false);
  }
});

test('without OS encryption the token is kept in memory only', async () => {
  const { gcal, configPath } = setup({ noEncryption: true });
  gcal.saveClient({ clientId: 'cid', clientSecret: 'secret' });
  await gcal.connect();
  assert.strictEqual(gcal.status().connected, true);
  assert.strictEqual(gcal.status().persistent, false);
  assert.ok(!fs.readFileSync(configPath, 'utf-8').includes('rt-1'));
});

test('events go to one app-created calendar; notes patch; goals are all-day', async () => {
  const { g, gcal } = setup();
  gcal.saveClient({ clientId: 'cid', clientSecret: 'secret' });
  await gcal.connect();
  const e1 = await gcal.insertSession(session);
  const e2 = await gcal.insertSession({ ...session, id: 's2', note: '', completed: false });
  assert.strictEqual(g.calls.filter((c) => c === 'POST /calendar/v3/calendars').length, 1);
  assert.strictEqual(g.events.get(e1).summary, 'Focus · essay');
  assert.strictEqual(g.events.get(e2).summary, 'Focus session');
  assert.match(g.events.get(e2).description, /stopped early/);
  assert.deepStrictEqual(g.events.get(e1).start, { dateTime: session.start });

  await gcal.patchSessionNote({ ...session, note: 'essay intro', gcalEventId: e1 });
  assert.strictEqual(g.events.get(e1).summary, 'Focus · essay intro');

  const eg = await gcal.insertGoal({ id: 'g1', title: 'Read ch. 3' }, '2026-09-30');
  assert.deepStrictEqual(g.events.get(eg).start, { date: '2026-09-30' });
  assert.deepStrictEqual(g.events.get(eg).end, { date: '2026-10-01' });
  await gcal.deleteEvent(eg);
  assert.ok(!g.events.has(eg));
  await gcal.deleteEvent(eg); // already gone: tolerated
});

test('a deleted calendar surfaces as CalendarGoneError and is recreated next time', async () => {
  const { g, gcal } = setup();
  gcal.saveClient({ clientId: 'cid', clientSecret: 'secret' });
  await gcal.connect();
  await gcal.insertSession(session);
  g.calendars.clear();
  await assert.rejects(gcal.insertSession(session), CalendarGoneError);
  await gcal.insertSession(session);
  assert.strictEqual(g.calls.filter((c) => c === 'POST /calendar/v3/calendars').length, 2);
});

test('expired access tokens refresh; a revoked grant disconnects with a clear message', async () => {
  const { g, gcal } = setup({ tokenExpiresIn: 0 });
  gcal.saveClient({ clientId: 'cid', clientSecret: 'secret' });
  await gcal.connect();
  await gcal.insertSession(session);
  assert.ok(g.calls.filter((c) => c === 'POST /token').length >= 2, 'refreshed before the API call');

  g.failNext = 401;
  await gcal.insertSession(session); // retried once with a fresh token

  g.refreshValid = false;
  g.failNext = 401;
  await assert.rejects(gcal.insertSession(session), /expired or was revoked/);
  assert.strictEqual(gcal.status().connected, false);
});

test('disconnect revokes and forgets the token and calendar', async () => {
  const { g, gcal, configPath } = setup();
  gcal.saveClient({ clientId: 'cid', clientSecret: 'secret' });
  await gcal.connect();
  await gcal.insertSession(session);
  await gcal.disconnect();
  assert.ok(g.calls.includes('POST /revoke'));
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  assert.strictEqual(saved.refreshTokenEnc, undefined);
  assert.strictEqual(saved.calendarId, undefined);
  assert.strictEqual(gcal.status().connected, false);
  assert.strictEqual(gcal.status().configured, true, 'client stays saved for reconnecting');
});

test('nextDay crosses month and year ends', () => {
  assert.strictEqual(nextDay('2026-09-30'), '2026-10-01');
  assert.strictEqual(nextDay('2026-12-31'), '2027-01-01');
  assert.strictEqual(nextDay('2028-02-28'), '2028-02-29');
});
