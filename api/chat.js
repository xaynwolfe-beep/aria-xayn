export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {}
  }

  const { action, messages, tokens, code } = body || {};

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const REDIRECT_URI = 'https://aria-xayn.vercel.app/api/auth/callback';

  // Step 1: Get Google login URL
  if (action === 'getAuthUrl') {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/userinfo.email'
      ].join(' '),
      access_type: 'offline',
      prompt: 'consent'
    });
    return res.status(200).json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }

  // Step 2: Exchange code for tokens
  if (action === 'exchangeCode') {
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code'
        })
      });
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error_description || data.error });
      return res.status(200).json({ tokens: data });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Step 3: Chat with real Gmail + Calendar data
  if (action === 'chat') {
    if (!tokens || !tokens.access_token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const auth = { 'Authorization': `Bearer ${tokens.access_token}` };
    let context = '';

    // Fetch real unread emails
    try {
      const listRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=UNREAD&maxResults=10',
        { headers: auth }
      );
      const listData = await listRes.json();

      if (listData.messages && listData.messages.length > 0) {
        const emailDetails = await Promise.all(
          listData.messages.slice(0, 10).map(m =>
            fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
              { headers: auth }
            ).then(r => r.json())
          )
        );

        context += `USER'S REAL UNREAD EMAILS (${emailDetails.length} emails):\n`;
        emailDetails.forEach((d, i) => {
          const headers = d.payload?.headers || [];
          const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
          const subject = headers.find(h => h.name === 'Subject')?.value || 'No subject';
          const date = headers.find(h => h.name === 'Date')?.value || '';
          context += `${i+1}. From: ${from} | Subject: ${subject} | Date: ${date}\n`;
        });
        context += '\n';
      } else {
        context += 'USER HAS NO UNREAD EMAILS.\n\n';
      }
    } catch(e) {
      context += `Could not fetch emails: ${e.message}\n\n`;
    }

    // Fetch real calendar events
    try {
      const calRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${new Date().toISOString()}&maxResults=10&singleEvents=true&orderBy=startTime`,
        { headers: auth }
      );
      const calData = await calRes.json();

      if (calData.items && calData.items.length > 0) {
        context += `USER'S REAL UPCOMING CALENDAR EVENTS (${calData.items.length} events):\n`;
        calData.items.forEach((e, i) => {
          const time = e.start?.dateTime || e.start?.date || 'No time';
          context += `${i+1}. ${e.summary || 'Untitled'} at ${time}\n`;
        });
        context += '\n';
      } else {
        context += 'USER HAS NO UPCOMING CALENDAR EVENTS.\n\n';
      }
    } catch(e) {
      context += `Could not fetch calendar: ${e.message}\n\n`;
    }

    // Call Groq with real data
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1024,
          messages: [
            {
              role: 'system',
              content: `You are Aria, a warm and helpful personal assistant. You have access to the user's REAL Gmail inbox and Google Calendar data shown below. IMPORTANT: Only refer to the actual data provided. Do not make up or invent any emails or events. If the data shows specific emails or events, mention them by name exactly as shown.

${context}

When asked about emails, list the actual emails from the data above. When asked about calendar, list the actual events from the data above. Be concise and friendly.`
            },
            ...(messages || [])
          ]
        })
      });

      const groqData = await groqRes.json();
      const reply = groqData.choices?.[0]?.message?.content;
      if (!reply) return res.status(500).json({ error: 'No response from AI: ' + JSON.stringify(groqData) });
      return res.status(200).json({ reply });
    } catch(e) {
      return res.status(500).json({ error: 'AI error: ' + e.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action: ' + action });
}
