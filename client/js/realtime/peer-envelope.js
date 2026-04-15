/*
This module wraps and unwraps encrypted peer envelopes that carry application
messages between IOU clients. The envelope format keeps routing fields (id,
from, to) in plaintext so the signaling server can deliver messages to offline
peers without learning their contents, while the inner message — the original
peer message model — is encrypted to the recipient's public key.

Inner messages are Schnorr-signed by the sender before encryption. The
signature covers a canonical JSON digest of the message (id, type, from, to,
created_at, payload) and travels inside the encrypted inner blob. This gives
us non-repudiation and lets a recipient verify messages authored by a third
party that are forwarded during ledger sync — AES-GCM authentication only
tells us "someone with the ECDH shared secret produced this," which isn't
enough once messages can travel transitively.

After decryption, callers must trust the returned `inner` only after:
  1. The envelope's plaintext claims match the inner fields (AES-GCM already
     authenticates the inner content; mismatched outer fields mean the
     plaintext envelope was tampered with).
  2. The Schnorr signature on the inner message verifies against
     `from_user_id` as an x-only public key.
*/

import { decryptFromPeer, encryptForPeer } from "../crypto/peer-crypto.js";
import { canonicalJsonForSigning } from "../crypto/canonical.js";
import {
  schnorrSignHex,
  schnorrVerifyHex,
  sha256HexOfString,
} from "../crypto/secp256k1.js";
import { decodeNpubToHex } from "../utils/nostr-keys.js";

export const PEER_ENVELOPE_TYPE = "peer_envelope";
export const PEER_ENVELOPE_VERSION = 2;

export const isPeerEnvelope = (value) => {
  return Boolean(value) && typeof value === "object" && value.type === PEER_ENVELOPE_TYPE;
};

const toPublicKeyHex = (userId) => {
  if (typeof userId !== "string" || !userId) {
    throw new Error("User id is required to resolve a public key.");
  }
  return userId.startsWith("npub1") ? decodeNpubToHex(userId) : userId.toLowerCase();
};

// Compute the Schnorr digest over an inner message. Excludes the `signature`
// field so signing and verifying produce the same pre-image.
export const digestForSigning = async (innerMessage) => {
  const canonical = canonicalJsonForSigning(innerMessage);
  return sha256HexOfString(canonical);
};

export const signInnerMessage = async (innerMessage, { privateKeyHex }) => {
  if (!privateKeyHex) {
    throw new Error("A private key is required to sign a peer message.");
  }
  const digestHex = await digestForSigning(innerMessage);
  return schnorrSignHex(digestHex, privateKeyHex);
};

// Reconstruct the inner-message shape from a stored ledger entry and verify
// its Schnorr signature. Ledger entries hold the sender-asserted timestamp
// under `originated_at` (the local `timestamp` is set on receive and is not
// part of the signed digest).
export const verifyLedgerEntrySignature = async (entry) => {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.signature !== "string" || !entry.signature) return false;
  const innerShape = {
    id: entry.id,
    type: entry.type,
    from_user_id: entry.from_user_id,
    to_user_id: entry.to_user_id,
    created_at: entry.originated_at || entry.timestamp || "",
    payload: entry.payload || {},
    signature: entry.signature,
  };
  return verifyInnerSignature(innerShape);
};

export const verifyInnerSignature = async (innerMessage) => {
  if (!innerMessage || typeof innerMessage.signature !== "string" || !innerMessage.signature) {
    return false;
  }
  let publicKeyHex;
  try {
    publicKeyHex = toPublicKeyHex(innerMessage.from_user_id);
  } catch {
    return false;
  }
  const { signature, ...withoutSignature } = innerMessage;
  const digestHex = await digestForSigning(withoutSignature);
  return schnorrVerifyHex(signature, digestHex, publicKeyHex);
};

export const wrapPeerMessage = async (message, { privateKeyHex }) => {
  if (!message || typeof message !== "object") {
    throw new Error("Cannot wrap an empty peer message.");
  }
  if (!message.id || !message.from_user_id || !message.to_user_id) {
    throw new Error("Peer message is missing routing fields required for the envelope.");
  }
  if (!privateKeyHex) {
    throw new Error("A private key is required to encrypt a peer envelope.");
  }

  // Sign the inner message (without an existing signature field) so the
  // signature travels protected under AES-GCM alongside the content. If the
  // caller already attached a signature at queue time, reuse it — signatures
  // are deterministic for a given (message, key), but reusing also lets the
  // ledger and outbox agree on the exact signature bytes.
  const unsigned = { ...message };
  delete unsigned.signature;
  const signature = typeof message.signature === "string" && message.signature
    ? message.signature
    : await signInnerMessage(unsigned, { privateKeyHex });
  const signedInner = { ...unsigned, signature };

  const ciphertext = await encryptForPeer(JSON.stringify(signedInner), {
    privateKeyHex,
    peerPublicKey: message.to_user_id,
  });

  return {
    type: PEER_ENVELOPE_TYPE,
    envelope_version: PEER_ENVELOPE_VERSION,
    id: message.id,
    from_user_id: message.from_user_id,
    to_user_id: message.to_user_id,
    ciphertext,
  };
};

export const unwrapPeerEnvelope = async (envelope, { privateKeyHex, expectedRecipientId }) => {
  if (!isPeerEnvelope(envelope)) {
    throw new Error("Value is not a peer envelope.");
  }
  if (!envelope.id || !envelope.from_user_id || !envelope.to_user_id || !envelope.ciphertext) {
    throw new Error("Peer envelope is missing required fields.");
  }
  if (expectedRecipientId && envelope.to_user_id !== expectedRecipientId) {
    throw new Error("Peer envelope is addressed to a different recipient.");
  }
  if (!privateKeyHex) {
    throw new Error("A private key is required to decrypt a peer envelope.");
  }

  const plaintext = await decryptFromPeer(envelope.ciphertext, {
    privateKeyHex,
    peerPublicKey: envelope.from_user_id,
  });

  let inner;
  try {
    inner = JSON.parse(plaintext);
  } catch {
    throw new Error("Peer envelope plaintext is not valid JSON.");
  }
  if (!inner || typeof inner !== "object") {
    throw new Error("Peer envelope plaintext is not an object.");
  }

  // Cross-check the plaintext envelope claims against the authenticated inner
  // fields. AES-GCM already guarantees the inner fields were not tampered
  // with, so any mismatch means the plaintext envelope was modified in transit.
  if (inner.id !== envelope.id) {
    throw new Error("Peer envelope id does not match its inner message.");
  }
  if (inner.from_user_id !== envelope.from_user_id) {
    throw new Error("Peer envelope from_user_id does not match its inner message.");
  }
  if (inner.to_user_id !== envelope.to_user_id) {
    throw new Error("Peer envelope to_user_id does not match its inner message.");
  }

  // Verify the Schnorr signature. This is what lets us trust forwarded
  // messages later — AES-GCM alone only proves the ECDH peer produced the
  // ciphertext; Schnorr proves the original author signed the content.
  const signatureValid = await verifyInnerSignature(inner);
  if (!signatureValid) {
    throw new Error("Peer envelope inner signature is invalid.");
  }

  return inner;
};
