export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, messages, tokens, code } = req.body;

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const REDIRECT_URI = 'https://aria-xayn.vercel.app/api/auth/callback';

  if (action === 'getAuthUrl') {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly',
      access_type: 'offline',
      prompt: 'consent'
    });
    return res.status(200).json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }

  if (action === 'exchangeCode') {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' })
    });
    const tokens = await r.json();
    return res.status(200).json({ tokens });
  }

  if (action === 'chat') {
    let context = '';
    const authHeader = { 'Authorization': `Bearer ${tokens.access_token}` };

    try {
      const emailList = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=UNREAD&maxResults=5', { headers: authHeader });
      const emailData = await emailList.json();
      if (emailData.messages) {
        const details = await Promise.all(emailData.messages.map(m =>
          fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: authHeader }).then(r => r.json())
        ));
        context += 'UNREAD EMAILS:\n' + details.map(d => {
          const h = d.payload?.headers || [];
          const get = n => h.find(x => x.name === n)?.value || '';
          return `- From: ${get('From')}, Subject: ${get('Subject')}`;
        }).join('\n') + '\n\n';
      }
    } catch(e) {}

    try {
      const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${new Date().toISOString()}&maxResults=10&singleEvents=true&orderBy=startTime`, { headers: authHeader });
      const calData = await calRes.json();
      if (calData.items?.length) {
        context += 'UPCOMING EVENTS:\n' + calData.items.map(e => `- ${e.summary} at ${e.start?.dateTime || e.start?.date}`).join('\n') + '\n\n';
      }
    } catch(e) {}

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: `You are Aria, a warm personal assistant with access to the user's Gmail and Calendar.\n\n${context}\nBe concise and helpful.` },
          ...messages
        ]
      })
    });
    const groqData = await groqRes.json();
    return res.status(200).json({ reply: groqData.choices?.[0]?.message?.content || 'Sorry, something went wrong.' });
  }

  res.status(400).json({ error: 'Invalid action' });
}
