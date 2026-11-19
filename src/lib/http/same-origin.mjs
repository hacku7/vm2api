export function sameOriginPost(req, publicBaseUrl) {
  const { origin, host, 'sec-fetch-site': site } = req?.headers || {}
  if (site !== undefined && site !== 'same-origin') return false
  if (origin === undefined) return site === 'same-origin'
  if (typeof origin !== 'string' || typeof host !== 'string' || /[^a-zA-Z0-9.:[\]-]/.test(host) || !host) return false
  try {
    const from = new URL(origin)
    if (from.origin !== origin || !['http:', 'https:'].includes(from.protocol)) return false
    const direct = new URL(`${req.socket?.encrypted ? 'https' : 'http'}://${host}`).origin
    if (origin === direct) return true
    // Browser-controlled Fetch Metadata confirms TLS termination; don't trust forwarding headers.
    const httpsHost = new URL(`https://${host}`).origin
    if (!req.socket?.encrypted && site === 'same-origin' && origin === httpsHost) return true
    // A configured origin may describe a reverse proxy that rewrites Host. In that case, also
    // require the browser's confirmation rather than accepting that origin across panel aliases.
    return site === 'same-origin' && !!publicBaseUrl && origin === new URL(publicBaseUrl).origin
  } catch {
    return false
  }
}
