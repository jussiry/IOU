/*
The KeyProvider abstraction — the single seam through which all signing and
peer encryption flows.

Today the only implementation is the *local* provider, which holds the user's
secp256k1 private key in memory and performs operations directly (canonical
Schnorr signatures + AES-GCM peer encryption, exactly as before). The point of
funnelling every call site through this interface is forward-looking: once the
private key can live outside the app (a NIP-07 browser extension, a NIP-46
remote signer), those providers slot in here without the rest of the codebase
ever touching raw key material again.

The interface a provider exposes:

  type                              "local" | "nip07" | "nip46" | ...
  getPublicKeyHex()        -> hex   the provider's own x-only public key
  signCanonicalDigest(hex) -> hex   Schnorr signature over a 32-byte digest
  encryptForPeer(peerHex, plaintext)   -> ciphertext string
  decryptFromPeer(peerHex, ciphertext) -> plaintext string

All methods are async-friendly (return values may be promises) so remote
providers that round-trip to an extension or signer fit the same shape. Layer 1
keeps behaviour identical to the pre-abstraction code — this is a pure
plumbing change.
*/

import {
  encryptForPeer as aesEncryptForPeer,
  decryptFromPeer as aesDecryptFromPeer,
} from "./peer-crypto.js";
import { schnorrSignHex, derivePublicKeyHex } from "./secp256k1.js";

// A provider backed by an in-memory private key. This is the original
// behaviour, just behind the interface: canonical Schnorr signing and AES-GCM
// peer encryption, both keyed by the local secret.
export const createLocalKeyProvider = ({ privateKeyHex, publicKeyHex } = {}) => {
  if (!privateKeyHex) {
    throw new Error("A local key provider requires a private key.");
  }
  // Derive the canonical x-only public key from the secret unless the caller
  // supplied a hex one. Deriving is safest — `state.user.id` may be an npub.
  const resolvedPublicKeyHex = publicKeyHex || derivePublicKeyHex(privateKeyHex);

  return {
    type: "local",
    getPublicKeyHex: () => resolvedPublicKeyHex,
    signCanonicalDigest: async (digestHex) => schnorrSignHex(digestHex, privateKeyHex),
    encryptForPeer: (peerPublicKeyHex, plaintext) =>
      aesEncryptForPeer(plaintext, { privateKeyHex, peerPublicKey: peerPublicKeyHex }),
    decryptFromPeer: (peerPublicKeyHex, ciphertext) =>
      aesDecryptFromPeer(ciphertext, { privateKeyHex, peerPublicKey: peerPublicKeyHex }),
  };
};

// Build the provider that matches the persisted user. Returns null when there
// is no usable key material (no user, or a user without a private key — e.g. a
// future external-signer account before its provider type is wired up here).
export const createKeyProviderFromState = (state) => {
  const privateKeyHex = state?.user?.private_key_hex || "";
  if (!privateKeyHex) {
    return null;
  }
  return createLocalKeyProvider({ privateKeyHex });
};
