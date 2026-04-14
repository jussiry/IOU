/*
Dev-only seed helper. When the URL contains `?seed`, this module writes a
preset app state into IndexedDB so the preview browser can skip the welcome
flow and start with realistic friends, transactions, and pending items.

Usage:
  http://localhost:…/?seed         — seed only if IDB is empty
  http://localhost:…/?seed=reset   — clear and reseed unconditionally

The param is stripped from the URL after seeding so reloads behave normally.
*/

import { DATA_MODEL_VERSION } from "../models/data-model.js";
import {
  FRIENDSHIP_STATUS_ACCEPTED,
  FRIENDSHIP_STATUS_PENDING_INCOMING,
} from "../utils/friendships.js";
import { clearAppState, loadAppState, saveAppState } from "../storage/indexeddb.js";

const SEED_PARAM = "seed";

// Fixed test keypair so seeded state is reproducible across preview restarts.
const SEED_USER = {
  publicKeyNpub: "npub10c0r3r9u0qfyk5q58r5zm73cgj7p23erlmyyppq2wj26quksp45s5xf43v",
  publicKeyHex: "7e1e388cbc78124b501438e82dfa3844bc154723fec840840a7495a072d00d69",
  privateKeyNsec: "nsec1s9ervmd04ueyp7km3qphq3skaejtsuf546kw47f8yp96mz6qmmxqvpcdde",
  privateKeyHex: "8172366dafaf3240fadb8803704616ee64b87134aeaceaf927204bad8b40decc",
};

// Stable fake npubs for seeded friends. Not cryptographically valid — fine for
// local UI testing since peer messages to them will just sit in the outbox.
const aliceId = "npub1seedaliceaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaalice";
const bobId = "npub1seedbobbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbob";
const carolId = "npub1seedcarolccccccccccccccccccccccccccccccccccccccccccccccccarol";

const buildSeedState = () => {
  const { privateKeyHex, privateKeyNsec, publicKeyHex, publicKeyNpub } = SEED_USER;

  const now = new Date();
  const iso = (offsetDays) =>
    new Date(now.getTime() - offsetDays * 86400000).toISOString();
  const date = (offsetDays) => iso(offsetDays).slice(0, 10);

  return {
    model_version: DATA_MODEL_VERSION,
    user: {
      id: publicKeyNpub,
      name: "Claude Preview",
      public_key: publicKeyNpub,
      public_key_hex: publicKeyHex,
      private_key: privateKeyNsec,
      private_key_hex: privateKeyHex,
      connections: [
        {
          person_id: aliceId,
          person_name: "Alice",
          friendship_status: FRIENDSHIP_STATUS_ACCEPTED,
          debt_eur: -15,
          trust_credit_limit_eur: 100,
          recent_transactions: [
            { id: "tx-seed-1", date: date(1), amount_eur: -15, note: "Lunch" },
            { id: "tx-seed-2", date: date(4), amount_eur: 25, note: "Taxi share" },
            { id: "tx-seed-3", date: date(10), amount_eur: -25, note: "Concert ticket" },
          ],
          last_synced_at: iso(0),
        },
        {
          person_id: bobId,
          person_name: "Bob",
          friendship_status: FRIENDSHIP_STATUS_ACCEPTED,
          debt_eur: 42,
          trust_credit_limit_eur: 200,
          recent_transactions: [
            { id: "tx-seed-4", date: date(2), amount_eur: 42, note: "Groceries" },
          ],
          pending_payment_request: {
            id: "pr-seed-1",
            amount_eur: 12,
            note: "Coffee round",
            is_incoming: true,
            created_at: iso(0),
          },
          last_synced_at: iso(1),
        },
        {
          person_id: carolId,
          person_name: "Carol",
          friendship_status: FRIENDSHIP_STATUS_PENDING_INCOMING,
          debt_eur: 0,
          trust_credit_limit_eur: 0,
          recent_transactions: [],
          last_synced_at: "",
        },
      ],
    },
    contacts: {
      [aliceId]: { id: aliceId, public_key: aliceId, name: "Alice" },
      [bobId]: { id: bobId, public_key: bobId, name: "Bob" },
      [carolId]: { id: carolId, public_key: carolId, name: "Carol" },
    },
    logs: [
      {
        id: "log-seed-1",
        timestamp: iso(1),
        text: "You sent €15.00 to **Alice**",
        message: "Lunch",
        friend_id: aliceId,
        amount_eur: 15,
        transaction_id: "tx-seed-1",
      },
      {
        id: "log-seed-2",
        timestamp: iso(2),
        text: "**Bob** sent you €42.00",
        message: "Groceries",
        friend_id: bobId,
        amount_eur: 42,
        transaction_id: "tx-seed-4",
      },
    ],
    outbox: [],
    processed_peer_message_ids: [],
  };
};

const stripSeedParam = () => {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SEED_PARAM)) return;
  url.searchParams.delete(SEED_PARAM);
  window.history.replaceState(null, "", url.toString() + window.location.hash);
};

export const applyDevSeedIfRequested = async () => {
  // Test/harness hook: an init-script may inject a full app state on
  // window.__IOU_SEED_STATE so the app boots directly into that state
  // without going through the welcome flow.
  if (window.__IOU_SEED_STATE && typeof window.__IOU_SEED_STATE === "object") {
    try {
      await clearAppState();
      await saveAppState(window.__IOU_SEED_STATE);
    } catch {
      // best-effort
    }
    try {
      delete window.__IOU_SEED_STATE;
    } catch {
      window.__IOU_SEED_STATE = null;
    }
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (!params.has(SEED_PARAM)) return;

  const mode = params.get(SEED_PARAM);
  const force = mode === "reset";

  try {
    if (force) {
      await clearAppState();
    } else {
      const existing = await loadAppState();
      if (existing && existing.user) {
        stripSeedParam();
        return;
      }
    }

    await saveAppState(buildSeedState());
  } catch (error) {
    // seeding is best-effort; fall through to normal flow
  }

  stripSeedParam();
};
