import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
https://aria-xayn.vercel.app/api/auth/callback
```

Then also go to **Google Cloud Console → Google Auth Platform → Clients → click your Aria client → edit** and update the redirect URI:

Change:
```
https://aria-xayn.vercel.app/auth/callback
```
To:
```
https://aria-xayn.vercel.app/api/auth/callback
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, messages, tokens, code } = req.body;

  // Get Google auth URL
  if (action === 'getAuthUrl') {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events'
      ]
    });
    return res.status(200).json({ url });
  }

  // Exchange code for tokens
  if (action === 'exchangeCode') {
    const { tokens } = await oauth2Client.getToken(code);
    return res.status(200).json({ tokens });
  }

  // Chat with Gmail/Calendar context
  if (action === 'chat') {
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    let context = '';

    try {
      // Get unread emails
      const emails = await gmail.users.messages.list({
        userId: 'me', labelIds: ['UNREAD'], maxResults: 5
      });
      if (emails.data.messages) {
        const details = await Promise.all(emails.data.messages.map(m =>
          gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'] })
        ));
        context += 'UNREAD EMAILS:\n' + details.map(d => {
          const h = d.data.payload.headers;
          const get = name => h.find(x => x.name === name)?.value || '';
          return `- From: ${get('From')}, Subject: ${get('Subject')}, Date: ${get('Date')}`;
        }).join('\n') + '\n\n';
      }
    } catch(e) {}

    try {
      // Get calendar events
      const events = await calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults: 10, singleEvents: true, orderBy: 'startTime'
      });
      if (events.data.items?.length) {
        context += 'UPCOMING CALENDAR EVENTS:\n' + events.data.items.map(e =>
          `- ${e.summary} at ${e.start.dateTime || e.start.date}`
        ).join('\n') + '\n\n';
      }
    } catch(e) {}

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: `You are Aria, a smart personal assistant with access to the user's real Gmail and Google Calendar. Here is their current data:\n\n${context}\n\nHelp them manage their emails and calendar. Be concise and warm.` },
          ...messages
        ]
      })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'Sorry, something went wrong.';
    return res.status(200).json({ reply });
  }

  res.status(400).json({ error: 'Invalid action' });
}
