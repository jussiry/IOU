/*
Helpers for relay-server URLs.

The "main" relay is implicit — it is the WebSocket endpoint on the same host
that served the app bundle, derived from `window.location`. We don't store it
in state because it changes automatically with the deployment domain.

Secondary relays are user-added and stored as plain string URLs in
`state.relays`. They are validated to be `ws://` or `wss://` and normalised
(trimmed, no trailing slash) so equality checks work reliably.
*/

const RELAY_PATH = "/ws";

export const getMainRelayUrl = () => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${RELAY_PATH}`;
};

// Liberal input parser:
// - trim whitespace
// - if no protocol, match the page protocol: `http:` page → `ws://`,
//   `https:` page → `wss://`. This makes plain-WebSocket dev relays usable
//   from a local dev page without forcing the user to type `ws://` every time,
//   while still defaulting to TLS in production where mixed content is blocked.
// - reject http(s) URLs so the user notices the typo
// - reject anything that doesn't parse as a URL with a host
// - strip trailing slash so two equivalent URLs compare equal
// Returns the normalised URL string, or `null` if invalid.
export const normalizeRelayUrl = (input) => {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return null;

  const defaultProtocol =
    typeof window !== "undefined" && window.location?.protocol === "https:"
      ? "wss://"
      : "ws://";

  const withProtocol =
    lower.startsWith("ws://") || lower.startsWith("wss://")
      ? trimmed
      : `${defaultProtocol}${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    if (!url.host) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

export const isSameRelayUrl = (left, right) => {
  const a = normalizeRelayUrl(left);
  const b = normalizeRelayUrl(right);
  return Boolean(a) && a === b;
};
