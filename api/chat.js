export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { messages, apiKey } = req.body;
  const key = apiKey || process.env.GEMINI_API_KEY;

  const geminiMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: 'You are Aria, a smart, warm personal assistant for calendar and email tasks. Be concise and helpful.' }] },
          contents: geminiMessages
        })
      }
    );
    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || data.error?.message || 'No response';
    res.status(200).json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
