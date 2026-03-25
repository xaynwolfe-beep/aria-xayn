export default async function handler(req, res) {
  const code = req.query.code;
  const error = req.query.error;

  if (error) {
    return res.redirect(302, `/?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(302, '/?error=no_code');
  }

  return res.redirect(302, `/?code=${encodeURIComponent(code)}`);
}
