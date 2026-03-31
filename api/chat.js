export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, messages, tokens, code, to, subject, body, messageId, title, startDateTime, endDateTime, description, eventId } = req.body || {};

    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const REDIRECT_URI = 'https://aria-xayn.vercel.app/api/auth/callback';

    if (action === 'getAuthUrl') {
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: [
          'https://mail.google.com/',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.compose',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile'
        ].join(' '),
        access_type: 'offline',
        prompt: 'consent'
      });
      return res.status(200).json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
    }

    if (action === 'exchangeCode') {
      if (!code) return res.status(400).json({ error: 'No code provided' });
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }).toString()
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) return res.status(400).json({ error: tokenData.error_description || tokenData.error });
      return res.status(200).json({ tokens: tokenData });
    }

    if (action === 'sendEmail') {
      if (!tokens?.access_token) return res.status(401).json({ error: 'Not authenticated' });
      const raw = Buffer.from([`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n'))
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw })
      });
      const sendData = await sendRes.json();
      if (sendData.error) return res.status(400).json({ error: sendData.error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'deleteEmail') {
      if (!tokens?.access_token) return res.status(401).json({ error: 'Not authenticated' });
      await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`, {
        method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'createEvent') {
      if (!tokens?.access_token) return res.status(401).json({ error: 'Not authenticated' });
      const eventRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: title, description: description || '', start: { dateTime: startDateTime, timeZone: 'Asia/Kuala_Lumpur' }, end: { dateTime: endDateTime, timeZone: 'Asia/Kuala_Lumpur' } })
      });
      const eventData = await eventRes.json();
      if (eventData.error) return res.status(400).json({ error: eventData.error.message });
      return res.status(200).json({ success: true, event: eventData });
    }

    if (action === 'deleteEvent') {
      if (!tokens?.access_token) return res.status(401).json({ error: 'Not authenticated' });
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'chat') {
      if (!tokens?.access_token) return res.status(401).json({ error: 'Not authenticated. Please sign in again.' });

      const authHeader = { Authorization: `Bearer ${tokens.access_token}` };
      const lastMsg = messages?.[messages.length - 1]?.content?.toLowerCase() || '';
      let context = '';

      // Fetch ALL email folders in parallel
      try {
       const wantsSent = lastMsg.includes('sent');
const wantsUnread = lastMsg.includes('unread');
const wantsStarred = lastMsg.includes('starred');

const fetchLabel = (label) => fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&labelIds=${label}`, { headers: authHeader }).then(r => r.json());

const [inboxData, sentData, unreadData, starredData] = await Promise.all([
  (!wantsSent && !wantsUnread && !wantsStarred) ? fetchLabel('INBOX') : Promise.resolve({}),
  wantsSent ? fetchLabel('SENT') : Promise.resolve({}),
  wantsUnread ? fetchLabel('UNREAD') : Promise.resolve({}),
  wantsStarred ? fetchLabel('STARRED') : Promise.resolve({})
]);

        const [inboxData, sentData, unreadData, starredData] = await Promise.all([
          inboxRes.json(), sentRes.json(), unreadRes.json(), starredRes.json()
        ]);

        const allEmails = new Map();
        const addEmails = (msgs, label) => (msgs || []).forEach(m => {
          allEmails.set(m.id, allEmails.has(m.id) ? allEmails.get(m.id) + '+' + label : label);
        });
        addEmails(inboxData.messages, 'INBOX');
        addEmails(sentData.messages, 'SENT');
        addEmails(unreadData.messages, 'UNREAD');
        addEmails(starredData.messages, 'STARRED');

        if (allEmails.size > 0) {
          const details = await Promise.all(
            [...allEmails.entries()].map(([id, label]) =>
              fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To`, { headers: authHeader })
                .then(r => r.json()).then(d => ({ ...d, _label: label }))
            )
          );
          context += `ALL EMAILS (${details.length} total - inbox, sent, unread, starred):\n`;
          details.forEach((d, i) => {
            const h = d.payload?.headers || [];
            const get = n => h.find(x => x.name === n)?.value || '';
           context += `${i+1}. [${d._label}] From: ${get('From')} | To: ${get('To')} | Subject: ${get('Subject')} | Date: ${get('Date')}\n`;
          });
          context += '\n';
        } else {
          context += 'No emails found.\n\n';
        }
      } catch(e) {
        context += `Email error: ${e.message}\n\n`;
      }

      // Fetch calendar events
      try {
        const now = new Date();
        let timeMin = now.toISOString();
        let timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        if (lastMsg.includes('today')) { const end = new Date(now); end.setHours(23,59,59); timeMax = end.toISOString(); }
        else if (lastMsg.includes('tomorrow')) { const s = new Date(now); s.setDate(s.getDate()+1); s.setHours(0,0,0); const e = new Date(s); e.setHours(23,59,59); timeMin = s.toISOString(); timeMax = e.toISOString(); }

        const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&maxResults=50&singleEvents=true&orderBy=startTime`, { headers: authHeader });
        const calData = await calRes.json();

        if (calData.items?.length > 0) {
          context += `CALENDAR EVENTS (${calData.items.length}):\n`;
          calData.items.forEach((e, i) => {
            context += `${i+1}. ID:${e.id} | ${e.summary||'Untitled'} | Start: ${e.start?.dateTime||e.start?.date} | End: ${e.end?.dateTime||e.end?.date}\n`;
          });
        } else {
          context += 'CALENDAR: No upcoming events.\n';
        }
      } catch(e) {
        context += `Calendar error: ${e.message}\n`;
      }

  const systemPrompt = `You are Aria, a smart personal assistant with FULL access to the user's Gmail and Google Calendar.\n\nRULES:\n- ONLY use the real data below. NEVER invent emails or events.\n- You can see inbox, sent, unread, and starred emails.\n- Be warm, concise, helpful.\n- Today: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })} Malaysia time.\n\nLIVE DATA:\n${context}`;

const geminiMessages = messages.map(m => ({
  role: m.role === 'assistant' ? 'model' : 'user',
  parts: [{ text: m.content }]
}));

const geminiRes = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=${process.env.GEMINI_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: geminiMessages
    })
  }
);

const geminiData = await geminiRes.json();
const reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
if (!reply) return res.status(500).json({ error: 'AI error: ' + JSON.stringify(geminiData) });
return res.status(200).json({ reply });
