export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, messages, tokens, code } = req.body || {};

    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const REDIRECT_URI = 'https://aria-xayn.vercel.app/api/auth/callback';

    // ── 1. Get Google OAuth URL ──────────────────────────────────────────────
    if (action === 'getAuthUrl') {
      if (!CLIENT_ID) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not set' });

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

      return res.status(200).json({
        url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
      });
    }

    // ── 2. Exchange auth code for tokens ─────────────────────────────────────
    if (action === 'exchangeCode') {
      if (!code) return res.status(400).json({ error: 'No code provided' });

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code'
        }).toString()
      });

      const tokenData = await tokenRes.json();
      if (tokenData.error) {
        return res.status(400).json({ error: tokenData.error, description: tokenData.error_description });
      }

      // Fetch user profile
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const profile = await profileRes.json();

      return res.status(200).json({ tokens: tokenData, profile });
    }

    // ── 3. Chat with full Gmail + Calendar access ─────────────────────────────
    if (action === 'chat') {
      if (!tokens?.access_token) {
        return res.status(401).json({ error: 'Not authenticated. Please sign in again.' });
      }

      const authHeader = { Authorization: `Bearer ${tokens.access_token}` };
      const lastUserMessage = messages?.[messages.length - 1]?.content?.toLowerCase() || '';
      let context = '';

      const wantsUnread      = lastUserMessage.includes('unread') || lastUserMessage.includes('summarise') || lastUserMessage.includes('summarize');
      const wantsSearch      = lastUserMessage.includes('find email') || lastUserMessage.includes('search email') || lastUserMessage.includes('email about') || lastUserMessage.includes('emails about');
      const wantsCalendar    = lastUserMessage.includes('calendar') || lastUserMessage.includes('event') || lastUserMessage.includes('schedule') || lastUserMessage.includes('meeting') || lastUserMessage.includes('appointment') || lastUserMessage.includes('today') || lastUserMessage.includes('tomorrow') || lastUserMessage.includes('week');

    // ── Fetch emails ────────────────────────────────────────────────────────
      if (!wantsCalendar || wantsUnread || wantsSearch) {
        try {
          // Always fetch ALL folders in parallel
          const [inboxRes, sentRes, unreadRes, starredRes] = await Promise.all([
            fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&labelIds=INBOX', { headers: authHeader }),
            fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&labelIds=SENT', { headers: authHeader }),
            fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&labelIds=UNREAD', { headers: authHeader }),
            fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&labelIds=STARRED', { headers: authHeader })
          ]);
          const [inboxData, sentData, unreadData, starredData] = await Promise.all([
            inboxRes.json(), sentRes.json(), unreadRes.json(), starredRes.json()
          ]);

          const allIds = new Map();
          const tag = (msgs, label) => (msgs || []).forEach(m => {
            if (!allIds.has(m.id)) allIds.set(m.id, label);
          });
          tag(inboxData.messages, 'INBOX');
          tag(sentData.messages, 'SENT');
          tag(unreadData.messages, 'UNREAD');
          tag(starredData.messages, 'STARRED');

          const details = await Promise.all(
            [...allIds.entries()].map(([id, label]) =>
              fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To`,
                { headers: authHeader }
              ).then(r => r.json()).then(d => ({ ...d, _label: label }))
            )
          );

          const emailUrl = ''; // not used anymore
          if (details.length > 0) {
            context += `ALL EMAILS (${details.length} total from inbox, sent, unread, starred):\n`;
            context += details.map((d, i) => {
              const h = d.payload?.headers || [];
              const get = n => h.find(x => x.name === n)?.value || '(unknown)';
              return `${i+1}. [${d._label}] ID:${d.id} | From: ${get('From')} | To: ${get('To')} | Subject: ${get('Subject')} | Date: ${get('Date')} | Preview: ${(d.snippet||'').slice(0,80)}`;
            }).join('\n') + '\n\n';
          } else {
            context += 'No emails found.\n\n';
          }

          // dummy to satisfy existing if-block structure
          const listData = { messages: [] };
          if (false) {
            let emailUrl2 = '';

          const listRes  = await fetch(emailUrl, { headers: authHeader });
          const listData = await listRes.json();

          if (listData.messages?.length > 0) {
            const details = await Promise.all(
              listData.messages.map(m =>
                fetch(
                  `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To`,
                  { headers: authHeader }
                ).then(r => r.json())
              )
            );

            const label = wantsUnread ? 'UNREAD EMAILS' : wantsSearch ? 'MATCHING EMAILS' : 'INBOX EMAILS';
            context += `${label} (${details.length} total):\n`;
            context += details.map((d, i) => {
              const h   = d.payload?.headers || [];
              const get = n => h.find(x => x.name === n)?.value || '(unknown)';
              return `${i + 1}. ID:${d.id} | From: ${get('From')} | Subject: ${get('Subject')} | Date: ${get('Date')} | Preview: ${(d.snippet || '').slice(0, 80)}`;
            }).join('\n') + '\n\n';
         }
        } catch (e) {
          context += `Gmail error: ${e.message}\n\n`;
        }
      }

      // ── Read full email body if user asks about a specific one ──────────────
      const emailNumMatch = lastUserMessage.match(/(?:email\s*(?:number\s*)?#?|the\s+)(\d+)(?:st|nd|rd|th)?(?:\s+email)?/i);
      if (emailNumMatch) {
        const num = parseInt(emailNumMatch[1]) - 1;
        try {
          let emailUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25';
          if (lastUserMessage.includes('unread')) emailUrl += '&labelIds=UNREAD';
          else emailUrl += '&labelIds=INBOX';

          const listRes  = await fetch(emailUrl, { headers: authHeader });
          const listData = await listRes.json();

          if (listData.messages?.[num]) {
            const fullEmail = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${listData.messages[num].id}?format=full`,
              { headers: authHeader }
            ).then(r => r.json());

            const extractBody = (payload) => {
              if (!payload) return '';
              if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf-8').slice(0, 3000);
              if (payload.parts) {
                for (const part of payload.parts) {
                  if (part.mimeType === 'text/plain' && part.body?.data)
                    return Buffer.from(part.body.data, 'base64').toString('utf-8').slice(0, 3000);
                }
                for (const part of payload.parts) {
                  const b = extractBody(part); if (b) return b;
                }
              }
              return '';
            };

            const h   = fullEmail.payload?.headers || [];
            const get = n => h.find(x => x.name === n)?.value || '(unknown)';
            const body = extractBody(fullEmail.payload);
            context += `\nFULL EMAIL #${num + 1}:\nFrom: ${get('From')}\nTo: ${get('To')}\nSubject: ${get('Subject')}\nDate: ${get('Date')}\n\nBODY:\n${body || '(empty body)'}\n\n`;
          }
        } catch (e) {
          context += `Could not read full email: ${e.message}\n\n`;
        }
      }

      // ── Fetch calendar events ───────────────────────────────────────────────
      if (wantsCalendar || (!wantsUnread && !wantsSearch)) {
        try {
          const now = new Date();
          let timeMin = now.toISOString();
          let timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

          if (lastUserMessage.includes('today')) {
            const end = new Date(now); end.setHours(23, 59, 59); timeMax = end.toISOString();
          } else if (lastUserMessage.includes('tomorrow')) {
            const s = new Date(now); s.setDate(s.getDate() + 1); s.setHours(0, 0, 0);
            const e = new Date(s);   e.setHours(23, 59, 59);
            timeMin = s.toISOString(); timeMax = e.toISOString();
          } else if (lastUserMessage.includes('this week')) {
            const e = new Date(now); e.setDate(e.getDate() + 7); timeMax = e.toISOString();
          }

          const calRes  = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&maxResults=50&singleEvents=true&orderBy=startTime`,
            { headers: authHeader }
          );
          const calData = await calRes.json();

          if (calData.items?.length > 0) {
            context += `CALENDAR EVENTS (${calData.items.length} found):\n`;
            context += calData.items.map((e, i) => {
              const when = e.start?.dateTime || e.start?.date || 'unknown';
              const end  = e.end?.dateTime   || e.end?.date   || '';
              return `${i + 1}. ID:${e.id} | Title: ${e.summary || '(no title)'} | Start: ${when} | End: ${end} | Notes: ${e.description || 'none'}`;
            }).join('\n') + '\n\n';
          } else {
            context += `CALENDAR: No events found in this period.\n\n`;
          }
        } catch (e) {
          context += `Calendar error: ${e.message}\n\n`;
        }
      }

      // ── Call Groq ───────────────────────────────────────────────────────────
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 2048,
          messages: [
            {
              role: 'system',
              content: `You are Aria, an intelligent personal assistant with FULL access to the user's Gmail and Google Calendar.

YOUR CAPABILITIES:
- Read ALL emails (inbox, unread, search, full body)
- Send emails and reply
- Delete/trash emails  
- Read all calendar events (past and future)
- Create new calendar events
- Delete/cancel events

RULES:
- ONLY reference data shown below. NEVER make up emails or events.
- If asked to ACT (send, create, delete) — confirm what you'll do and say "Done!" or describe it clearly.
- Be warm, smart, and concise. Today: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })} Malaysia time.

LIVE DATA FROM USER'S ACCOUNT:
${context || '(No data loaded for this query)'}`
            },
            ...(messages || [])
          ]
        })
      });

      const groqData = await groqRes.json();
      const reply    = groqData.choices?.[0]?.message?.content;
      if (!reply) return res.status(500).json({ error: 'AI failed', detail: JSON.stringify(groqData) });
      return res.status(200).json({ reply });
    }

    // ── 4. Send Email ─────────────────────────────────────────────────────────
    if (action === 'sendEmail') {
      const { to, subject, body } = req.body;
      const authHeader = { Authorization: `Bearer ${tokens.access_token}` };
      const raw = Buffer.from(
        [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n')
      ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const sendRes  = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw })
      });
      const sendData = await sendRes.json();
      if (sendData.error) return res.status(400).json({ error: sendData.error.message });
      return res.status(200).json({ success: true, messageId: sendData.id });
    }

    // ── 5. Create Calendar Event ──────────────────────────────────────────────
    if (action === 'createEvent') {
      const { title, startDateTime, endDateTime, description } = req.body;
      const authHeader = { Authorization: `Bearer ${tokens.access_token}` };
      const eventRes  = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: title,
          description: description || '',
          start: { dateTime: startDateTime, timeZone: 'Asia/Kuala_Lumpur' },
          end:   { dateTime: endDateTime,   timeZone: 'Asia/Kuala_Lumpur' }
        })
      });
      const eventData = await eventRes.json();
      if (eventData.error) return res.status(400).json({ error: eventData.error.message });
      return res.status(200).json({ success: true, event: eventData });
    }

    // ── 6. Trash Email ────────────────────────────────────────────────────────
    if (action === 'deleteEmail') {
      const { messageId } = req.body;
      const delRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      return res.status(200).json({ success: delRes.ok });
    }

    // ── 7. Delete Calendar Event ──────────────────────────────────────────────
    if (action === 'deleteEvent') {
      const { eventId } = req.body;
      const delRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      return res.status(200).json({ success: delRes.ok });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
