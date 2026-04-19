/*
Owns the persistent application state: the in-memory cache, IndexedDB
round-trip, and the listener fan-out that keeps the UI in sync.

Everything here is about *where state lives and how it's saved* — domain
behaviour (friendship, transactions, trust limits, etc.) lives in the
`commands/` modules, and transport wiring lives in `peer/bridge.js`.
Both of those consume `loadState` and `persistAndBuildView` from here so
we keep a single source of truth for the state object.

User creation is included because it *initializes* the state — there is no
meaningful app state before `createUser` runs, and it doesn't belong in a
domain command module that assumes a state already exists.
*/

import {
  createEmptyAppState,
  createPersonModel,
  normalizeAppState,
} from "./models/data-model.js";
import {
  clearAppState,
  deleteDatabase,
  loadAppState,
  saveAppState,
} from "./storage/indexeddb.js";
import {
  generateNostrKeyPair,
  decodeNsecToHex,
  deriveNostrPublicKeyHex,
  encodeNpubFromPublicKeyHex,
  encodeNsecFromPrivateKeyHex,
} from "./utils/nostr-keys.js";
import { decryptNcryptsec } from "./crypto/nip49.js";
import { asTrimmedString, createId, hasUser } from "./state-utils.js";
import { buildView } from "./ui/view-model.js";
import { appendLedgerEntryFromMessage } from "./ledger.js";
import { signInnerMessage } from "./peer/envelope.js";
import { createPeerMessageModel } from "./models/data-model.js";
import { PEER_MESSAGE_TYPE_NAME_CHANGED } from "./peer/messages.js";

const VERSION_KEY = "iou_version";

let cachedState = null;
const dataListeners = new Set();

const emitDataChange = (state) => {
  const view = buildView(state);
  dataListeners.forEach((listener) => {
    try {
      listener(view);
    } catch {
      // ignore listener failures so persistence remains reliable
    }
  });
  return view;
};

// Exported for command modules and the realtime bridge — they need the same
// cached state this module owns. Not meant for UI code; UI subscribes via
// `subscribeToDataChanges` and reads the view object.
export const loadState = async () => {
  if (cachedState) return cachedState;
  const persistedState = await loadAppState();
  cachedState = normalizeAppState(persistedState);
  return cachedState;
};

export const persistState = async (state) => {
  const normalizedState = normalizeAppState(state);
  if (!normalizedState) {
    throw new Error("Cannot persist invalid application state.");
  }

  cachedState = normalizedState;
  await saveAppState(normalizedState);
  return normalizedState;
};

export const persistAndBuildView = async (state) => {
  const persistedState = await persistState(state);
  return emitDataChange(persistedState);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const subscribeToDataChanges = (listener) => {
  if (typeof listener !== "function") {
    return () => {};
  }

  dataListeners.add(listener);
  return () => {
    dataListeners.delete(listener);
  };
};

export const hasUserData = async () => {
  const state = await loadState();
  return hasUser(state);
};

export const loadData = async () => {
  const state = await loadState();
  if (!hasUser(state)) {
    return null;
  }
  return buildView(state);
};

export const createUser = async (name, { existingNsec, ncryptsec, passphrase } = {}) => {
  const trimmedName = asTrimmedString(name);

  let privateKeyHex, privateKeyNsec, publicKeyHex, publicKeyNpub;

  if (ncryptsec) {
    // Throws "Incorrect passphrase." on Poly1305 tag mismatch — caller handles.
    privateKeyHex = decryptNcryptsec(ncryptsec, passphrase);
    privateKeyNsec = encodeNsecFromPrivateKeyHex(privateKeyHex);
    publicKeyHex = deriveNostrPublicKeyHex(privateKeyHex);
    publicKeyNpub = encodeNpubFromPublicKeyHex(publicKeyHex);
  } else if (existingNsec) {
    privateKeyHex = decodeNsecToHex(existingNsec);
    privateKeyNsec = existingNsec;
    publicKeyHex = deriveNostrPublicKeyHex(privateKeyHex);
    publicKeyNpub = encodeNpubFromPublicKeyHex(publicKeyHex);
  } else {
    ({ privateKeyHex, privateKeyNsec, publicKeyHex, publicKeyNpub } = generateNostrKeyPair());
  }

  const userName = trimmedName || publicKeyNpub;

  const user = createPersonModel({
    id: publicKeyNpub,
    name: userName,
    public_key: publicKeyNpub,
    public_key_hex: publicKeyHex,
    private_key: privateKeyNsec,
    private_key_hex: privateKeyHex,
    connections: [],
  });

  const state = createEmptyAppState(user);

  // Seed the ledger with a self-addressed name_changed entry only when this is
  // a genuinely new identity (fresh keypair). When the user is logging in with
  // an existing nsec/ncryptsec the real name lives in ledger entries already
  // synced from their other devices — creating a new entry here with the
  // current timestamp would make it the most-recent one, causing
  // applyOwnNameFromLedger to overwrite the actual name with the public key.
  const isNewIdentity = !existingNsec && !ncryptsec;
  if (isNewIdentity) {
    const initMsg = createPeerMessageModel({
      id: createId("peer"),
      type: PEER_MESSAGE_TYPE_NAME_CHANGED,
      from_user_id: publicKeyNpub,
      to_user_id: publicKeyNpub,
      created_at: new Date().toISOString(),
      payload: { name: userName },
    });
    try {
      const signature = await signInnerMessage(initMsg, { privateKeyHex });
      appendLedgerEntryFromMessage(state, { ...initMsg, signature });
    } catch {
      // Non-fatal: name entry will be missing until the user renames themselves.
    }
  }

  return persistAndBuildView(state);
};

// Private-key readers are deliberately separate from `loadData`/`buildView`,
// which strip private keys via `createPublicPersonModel` before they ever
// reach UI code. Only the transfer flow needs this — everything else should
// continue using the sanitized view.
export const loadCurrentUserPrivateKeyHex = async () => {
  const state = await loadState();
  return state?.user?.private_key_hex || "";
};

export const ensureVersion = async (version) => {
  try {
    const storedVersion = window.localStorage.getItem(VERSION_KEY);
    if (version && storedVersion !== version) {
      window.localStorage.setItem(VERSION_KEY, version);
    }
  } catch {
    // ignore version storage failures
  }
};

export const resetState = async () => {
  cachedState = null;
  try {
    await deleteDatabase();
  } catch {
    // ignore — reload handles any residual data
  }

  try {
    window.localStorage.removeItem(VERSION_KEY);
  } catch {
    // ignore
  }
};
