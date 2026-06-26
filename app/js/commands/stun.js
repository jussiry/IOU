/*
Commands for managing the user's STUN server list.

STUN servers are device-level WebRTC configuration: they help peers discover
their public reflexive address during ICE gathering so direct connections work
across networks. The list defaults to Cloudflare (seeded by `normalizeAppState`)
but is fully user-editable so the app stays self-hostable / decentralised.

Like the relay commands, these mutate only local state and emit no peer
messages — STUN choice is private and is never announced to friends.
*/

import { loadData, loadState, persistAndBuildView } from "../app-state.js";
import { isSameStunUrl, normalizeStunUrl } from "../utils/stun-url.js";

const MAX_STUN_SERVERS = 10;

export const addStunServer = async (rawUrl) => {
  const url = normalizeStunUrl(rawUrl);
  if (!url) return { ok: false, reason: "invalid" };

  const state = await loadState();
  if (!state) return { ok: false, reason: "no_state" };

  const existing = Array.isArray(state.stun_servers) ? state.stun_servers : [];
  if (existing.some((entry) => isSameStunUrl(entry, url))) {
    return { ok: false, reason: "duplicate" };
  }
  if (existing.length >= MAX_STUN_SERVERS) {
    return { ok: false, reason: "limit" };
  }

  state.stun_servers = [...existing, url];
  await persistAndBuildView(state);
  return { ok: true, url };
};

export const removeStunServer = async (rawUrl) => {
  const url = normalizeStunUrl(rawUrl);
  if (!url) return loadData();

  const state = await loadState();
  if (!state) return null;

  const existing = Array.isArray(state.stun_servers) ? state.stun_servers : [];
  const next = existing.filter((entry) => !isSameStunUrl(entry, url));
  if (next.length === existing.length) {
    return loadData();
  }

  state.stun_servers = next;
  return persistAndBuildView(state);
};
