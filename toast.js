// Windows toast XML for the phase-end notification.

function escapeXml(text) {
  return String(text).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

// Windows only keeps a toast on screen until the user acts on it in the
// "reminder" scenario, and only when it has at least one button. It plays
// the Windows alarm sound once (loop="false"); the app's own chime is only
// the fallback for when no toast is shown.
const ALARM_SOUND = 'ms-winsoundevent:Notification.Looping.Alarm';

function phaseToastXml(title, body) {
  return '<toast scenario="reminder">'
    + `<visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(body)}</text></binding></visual>`
    + '<actions><action content="Dismiss" arguments="dismiss" activationType="system"/></actions>'
    + `<audio src="${ALARM_SOUND}" loop="false"/>`
    + '</toast>';
}

module.exports = { phaseToastXml, ALARM_SOUND };
