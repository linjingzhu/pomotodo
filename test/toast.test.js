const test = require('node:test');
const assert = require('node:assert');
const { phaseToastXml, ALARM_SOUND } = require('../toast');

test('the phase toast stays up, plays the Windows alarm sound once, and escapes text', () => {
  const xml = phaseToastXml('Focus <time> is over', 'Take a "short" break & rest.');
  assert.match(xml, /^<toast scenario="reminder">/);
  assert.ok(xml.includes(`<audio src="${ALARM_SOUND}" loop="false"/>`));
  assert.ok(!xml.includes('silent="true"'));
  assert.ok(xml.includes('<action content="Dismiss"'));
  assert.ok(xml.includes('Focus &lt;time&gt; is over'));
  assert.ok(xml.includes('Take a &quot;short&quot; break &amp; rest.'));
});
