/*
This module wraps and unwraps encrypted peer envelopes that carry application
messages between IOU clients. The envelope format keeps routing fields (id,
from, to) in plaintext so the signaling server can deliver messages to offline
peers without learning their contents, while the inner message — the original
peer message model — is encrypted to the recipient's public key.

After decryption, callers must trust the returned `inner` only after the
envelope's plaintext claims have been cross-checked against the inner fields,
which `unwrapPeerEnvelope` performs before returning.
*/

import { decryptFromPeer, encryptForPeer } from "../crypto/peer-crypto.js";

export const PEER_ENVELOPE_TYPE = "peer_envelope";
export const PEER_ENVELOPE_VERSION = 1;

export const isPeerEnvelope = (value) => {
  return Boolean(value) && typeof value === "object" && value.type === PEER_ENVELOPE_TYPE;
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

  const ciphertext = await encryptForPeer(JSON.stringify(message), {
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

  return inner;
};
