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
      if (!CLIENT_ID) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not set in Vercel env vars' });

      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/calendar.events'
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
      if (!CLIENT_ID || !CLIENT_SECRET) {
        return res.status(500).json({ error: 'Google credentials not set in Vercel env vars' });
      }

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
        return res.status(400).json({
          error: tokenData.error,
          description: tokenData.error_description
        });
      }

      return res.status(200).json({ tokens: tokenData });
    }

    // ── 3. Chat with real Gmail + Calendar data ───────────────────────────────
    if (action === 'chat') {
      if (!tokens?.access_token) {
        return res.status(401).json({ error: 'Not authenticated. Please sign in again.' });
      }

      const authHeader = { Authorization: `Bearer ${tokens.access_token}` };
      let context = '';

      // Fetch unread emails
      try {
        const listRes = await fetch(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=UNREAD&maxResults=10',
          { headers: authHeader }
        );
        const listData = await listRes.json();

        if (listData.messages && listData.messages.length > 0) {
          const details = await Promise.all(
            listData.messages.slice(0, 10).map(m =>
              fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
                { headers: authHeader }
              ).then(r => r.json())
            )
          );

          context += `UNREAD EMAILS (${details.length} total):\n`;
          context += details.map(d => {
            const h = d.payload?.headers || [];
            const get = name => h.find(x => x.name === name)?.value || '(unknown)';
            return `- From: ${get('From')}\n  Subject: ${get('Subject')}\n  Date: ${get('Date')}`;
          }).join('\n') + '\n\n';
        } else if (listData.error) {
          context += `Gmail error: ${listData.error.message}\n\n`;
        } else {
          context += 'UNREAD EMAILS: None\n\n';
        }
      } catch (e) {
        context += `Gmail fetch failed: ${e.message}\n\n`;
      }

      // Fetch calendar events
      try {
        const now = new Date().toISOString();
        const calRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&maxResults=10&singleEvents=true&orderBy=startTime`,
          { headers: authHeader }
        );
        const calData = await calRes.json();

        if (calData.items && calData.items.length > 0) {
          context += `UPCOMING CALENDAR EVENTS (${calData.items.length} total):\n`;
          context += calData.items.map(e => {
            const when = e.start?.dateTime || e.start?.date || 'unknown time';
            return `- ${e.summary || '(no title)'} at ${when}`;
          }).join('\n') + '\n\n';
        } else if (calData.error) {
          context += `Calendar error: ${calData.error.message}\n\n`;
        } else {
          context += 'UPCOMING CALENDAR EVENTS: None\n\n';
        }
      } catch (e) {
        context += `Calendar fetch failed: ${e.message}\n\n`;
      }

      // Call Groq AI
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1024,
          messages: [
            {
              role: 'system',
              content: `You are Aria, a warm and intelligent personal assistant with LIVE access to the user's real Gmail inbox and Google Calendar.

IMPORTANT RULES:
- ONLY use the real data provided below. NEVER invent, guess, or fabricate emails or events.
- If the data shows errors, tell the user honestly.
- Be concise, warm, and helpful.
- Today's date and time: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })} (Malaysia time)

REAL LIVE DATA FROM USER'S ACCOUNT:
${context}

Use this data to answer questions. If asked to summarise emails, list ONLY the emails shown above.`
            },
            ...(messages || [])
          ]
        })
      });

      const groqData = await groqRes.json();
      const reply = groqData.choices?.[0]?.message?.content;

      if (!reply) {
        return res.status(500).json({
          error: 'AI response failed',
          detail: JSON.stringify(groqData)
        });
      }

      return res.status(200).json({ reply });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
