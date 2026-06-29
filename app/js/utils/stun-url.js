/*
Helpers for the user-configurable STUN server list.

STUN servers let each peer discover its public (post-NAT) "server-reflexive"
address, which is what makes direct WebRTC connections work across different
networks. Unlike relay servers, STUN endpoints hold no persistent connection —
the browser queries them only while gathering ICE candidates — so there is no
live status to track, just a list of URLs.

We default to Cloudflare's public STUN server. It is directly reachable over
UDP (a hard requirement: a STUN endpoint behind an L4/L7 proxy can't observe
the client's real reflexive address). The list is fully user-editable in
settings so the app can stay self-hostable / fully decentralised — a user can
point at their own STUN server and drop the default entirely.

Tally no longer ships a TURN server: when a direct P2P connection can't be
formed (e.g. symmetric NAT on cellular), the encrypted-envelope relay server
already carries messages between peers, covering the same need without a
separate TURN relay.
@category util
*/

// Cloudflare's public STUN endpoint. Chosen over Google's for its lighter
// privacy optics — although no user data is ever sent to a STUN server, only
// the reflexive-address probe.
export const DEFAULT_STUN_SERVERS = ["stun:stun.cloudflare.com:3478"];

// Liberal parser mirroring `normalizeRelayUrl`:
// - trim, lowercase the scheme
// - accept `stun:` and `stuns:`; default to `stun:` when no scheme is given
// - require a host (and, after the scheme, a `host:port` or `host` shape)
// - reject anything that isn't a plausible STUN URI
// Returns the normalised `stun:host[:port]` string, or `null` if invalid.
export const normalizeStunUrl = (input) => {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  // Reject obvious other-scheme mistakes so the user notices the typo.
  if (/^[a-z][a-z0-9+.-]*:/.test(lower) && !/^stuns?:/.test(lower)) {
    return null;
  }

  const withScheme = /^stuns?:/.test(lower) ? lower : `stun:${lower}`;
  const scheme = withScheme.startsWith("stuns:") ? "stuns" : "stun";
  const hostPort = withScheme.slice(scheme.length + 1).replace(/\/+$/, "");
  if (!hostPort) return null;

  // host[:port] — host must be non-empty; port, if present, must be numeric.
  const match = hostPort.match(/^([a-z0-9.-]+)(?::(\d{1,5}))?$/);
  if (!match) return null;
  const [, host, port] = match;
  if (!host) return null;
  if (port && Number(port) > 65535) return null;

  return port ? `${scheme}:${host}:${port}` : `${scheme}:${host}`;
};

export const isSameStunUrl = (left, right) => {
  const a = normalizeStunUrl(left);
  const b = normalizeStunUrl(right);
  return Boolean(a) && a === b;
};

// Normalise a stored list, dropping invalid/duplicate entries. Order preserved.
export const normalizeStunList = (values) => {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const url = normalizeStunUrl(value);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
};
