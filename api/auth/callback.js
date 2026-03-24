export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code provided');
  res.redirect(`/?code=${code}`);
}
