export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','Content-Type'); return res.status(200).end(); }
  const { messages, apiKey } = req.body;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type':'application/json','x-api-key': apiKey,'anthropic-version':'2023-06-01' },
    body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:1024, system:'You are Aria, a helpful assistant.', messages })
  });
  const d = await r.json();
  res.setHeader('Access-Control-Allow-Origin','*');
  res.status(200).json({ reply: d.content?.[0]?.text || d.error?.message || 'Error' });
}
