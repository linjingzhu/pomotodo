// Google Calendar sync: OAuth for installed apps (system browser + loopback
// redirect + PKCE) and the few Calendar API calls the app needs. Scope is
// calendar.app.created: the app can only touch the one calendar it creates,
// never the user's existing calendars. Dependencies are injected so the
// flow can be exercised without Electron or network access.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const CALENDAR_NAME = 'Pomodoro Timer';
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

class CalendarGoneError extends Error {}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function nextDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

function sessionEvent(session) {
  const minutes = Math.round(session.workedSec / 60);
  return {
    summary: session.note ? `Focus · ${session.note}` : 'Focus session',
    description: `${minutes} min of focus${session.completed ? '' : ' (stopped early)'} · Pomodoro Timer`,
    start: { dateTime: session.start },
    end: { dateTime: session.end },
    extendedProperties: { private: { pomodoroSessionId: session.id } },
  };
}

function goalEvent(goal, day) {
  return {
    summary: `Goal reached · ${goal.title}`,
    description: 'Pomodoro Timer',
    start: { date: day },
    end: { date: nextDay(day) },
    transparency: 'transparent',
    extendedProperties: { private: { pomodoroGoalId: goal.id } },
  };
}

function createGcal({ configFile, openExternal, encrypt, decrypt, fetchImpl = fetch, onStatus = () => {} }) {
  let config = readConfig();
  // Used when the OS can't encrypt: the token then lives only in memory
  // for this run rather than being written to disk in the clear.
  let memoryRefreshToken = null;
  let accessToken = null;
  let accessExpiresAt = 0;
  let lastError = null;
  let lastSyncAt = null;
  let connecting = false;

  function readConfig() {
    try {
      return JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    } catch (e) {
      return {};
    }
  }

  function writeConfig() {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
  }

  function refreshToken() {
    if (config.refreshTokenEnc) {
      try {
        return decrypt(config.refreshTokenEnc);
      } catch (e) {
        return null;
      }
    }
    return memoryRefreshToken;
  }

  function status() {
    return {
      configured: !!(config.clientId && config.clientSecret),
      clientId: config.clientId || '',
      connected: !!refreshToken(),
      connecting,
      persistent: !!config.refreshTokenEnc,
      calendarName: CALENDAR_NAME,
      lastSyncAt,
      error: lastError,
    };
  }

  function emit() {
    onStatus(status());
  }

  function setError(message) {
    lastError = message;
    emit();
  }

  function saveClient({ clientId, clientSecret }) {
    config.clientId = String(clientId || '').trim();
    // an empty secret field means "keep the one already saved"
    if (String(clientSecret || '').trim()) config.clientSecret = String(clientSecret).trim();
    writeConfig();
    lastError = null;
    emit();
    return status();
  }

  async function postForm(url, params) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = json.error_description || json.error || `HTTP ${res.status}`;
      const err = new Error(`Google sign-in failed: ${reason}`);
      err.oauthError = json.error;
      throw err;
    }
    return json;
  }

  // Listens on an ephemeral loopback port for Google's redirect. Resolves
  // once listening with the port and a promise of the authorization code.
  function listenForRedirect(state) {
    return new Promise((resolveListening, rejectListening) => {
      let settle;
      const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get('state') === state ? url.searchParams.get('code') : null;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(code
          ? '<p style="font-family:sans-serif">Pomodoro Timer is connected to Google Calendar. You can close this tab.</p>'
          : '<p style="font-family:sans-serif">Sign-in was cancelled or did not match. Close this tab and try again from the app.</p>');
        clearTimeout(timer);
        server.close();
        if (code) settle.resolve(code);
        else settle.reject(new Error(url.searchParams.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in did not complete.'));
      });
      const timer = setTimeout(() => {
        server.close();
        settle.reject(new Error('Google sign-in timed out after 5 minutes.'));
      }, CONNECT_TIMEOUT_MS);
      server.on('error', (e) => {
        clearTimeout(timer);
        rejectListening(e);
      });
      const close = () => {
        clearTimeout(timer);
        server.close();
        result.catch(() => {});
      };
      server.listen(0, '127.0.0.1', () => resolveListening({ port: server.address().port, code: result, close }));
    });
  }

  async function connect() {
    if (!status().configured) throw new Error('Enter your OAuth client ID and secret first.');
    if (connecting) throw new Error('Google sign-in is already open in your browser.');
    connecting = true;
    lastError = null;
    emit();
    try {
      const verifier = base64url(crypto.randomBytes(32));
      const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
      const state = base64url(crypto.randomBytes(16));
      const { port, code: codePromise, close } = await listenForRedirect(state);
      const redirectUri = `http://127.0.0.1:${port}`;
      const authUrl = `${AUTH_URL}?${new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
      })}`;
      try {
        await openExternal(authUrl);
      } catch (e) {
        close();
        throw new Error(`Could not open the browser for Google sign-in: ${e.message}`);
      }
      const code = await codePromise;
      const tokens = await postForm(TOKEN_URL, {
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      });
      if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
      const encrypted = encrypt(tokens.refresh_token);
      if (encrypted) {
        config.refreshTokenEnc = encrypted;
        memoryRefreshToken = null;
      } else {
        delete config.refreshTokenEnc;
        memoryRefreshToken = tokens.refresh_token;
      }
      delete config.calendarId;
      writeConfig();
      accessToken = tokens.access_token;
      accessExpiresAt = Date.now() + (tokens.expires_in - 60) * 1000;
      return true;
    } finally {
      connecting = false;
      emit();
    }
  }

  async function disconnect() {
    const token = refreshToken();
    if (token) {
      await fetchImpl(`${REVOKE_URL}?${new URLSearchParams({ token })}`, { method: 'POST' }).catch(() => {});
    }
    delete config.refreshTokenEnc;
    delete config.calendarId;
    memoryRefreshToken = null;
    accessToken = null;
    lastError = null;
    lastSyncAt = null;
    writeConfig();
    emit();
  }

  async function getAccessToken(force = false) {
    if (!force && accessToken && Date.now() < accessExpiresAt) return accessToken;
    const token = refreshToken();
    if (!token) throw new Error('Not connected to Google Calendar.');
    try {
      const json = await postForm(TOKEN_URL, {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: token,
        grant_type: 'refresh_token',
      });
      accessToken = json.access_token;
      accessExpiresAt = Date.now() + (json.expires_in - 60) * 1000;
      return accessToken;
    } catch (e) {
      if (e.oauthError === 'invalid_grant') {
        // revoked, expired (7 days for apps still in "Testing"), or password changed
        delete config.refreshTokenEnc;
        memoryRefreshToken = null;
        writeConfig();
        throw new Error('Google access expired or was revoked. Connect again.');
      }
      throw e;
    }
  }

  async function api(method, apiPath, body, retried = false) {
    const token = await getAccessToken(retried);
    const res = await fetchImpl(`${API}${apiPath}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) return api(method, apiPath, body, true);
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Google Calendar error: ${json.error?.message || `HTTP ${res.status}`}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async function calendarId() {
    if (config.calendarId) return config.calendarId;
    const cal = await api('POST', '/calendars', {
      summary: CALENDAR_NAME,
      description: 'Focus sessions and reached goals, written by Pomodoro Timer.',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    config.calendarId = cal.id;
    writeConfig();
    return cal.id;
  }

  async function insert(event) {
    const id = await calendarId();
    try {
      return (await api('POST', `/calendars/${encodeURIComponent(id)}/events`, event)).id;
    } catch (e) {
      if (e.status === 404) {
        // the user deleted the calendar; the caller recreates it and replays
        delete config.calendarId;
        writeConfig();
        throw new CalendarGoneError('The Pomodoro Timer calendar was deleted; recreating it.');
      }
      throw e;
    }
  }

  async function deleteEvent(eventId) {
    if (!config.calendarId || !eventId) return;
    try {
      await api('DELETE', `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(eventId)}`);
    } catch (e) {
      if (e.status !== 404 && e.status !== 410) throw e;
    }
  }

  async function patchSessionNote(session) {
    if (!config.calendarId || !session.gcalEventId) return;
    const { summary } = sessionEvent(session);
    await api('PATCH', `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(session.gcalEventId)}`, { summary });
  }

  function markSynced() {
    lastSyncAt = new Date().toISOString();
    lastError = null;
    emit();
  }

  return {
    status,
    saveClient,
    connect,
    disconnect,
    isConnected: () => !!refreshToken(),
    insertSession: (session) => insert(sessionEvent(session)),
    insertGoal: (goal, day) => insert(goalEvent(goal, day)),
    deleteEvent,
    patchSessionNote,
    markSynced,
    setError,
  };
}

module.exports = { createGcal, CalendarGoneError, sessionEvent, goalEvent, nextDay, SCOPE };
