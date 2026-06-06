/*
This module provides authenticated encryption between two IOU peers using their
secp256k1 keypairs. It derives a shared symmetric key via ECDH on the peer's
x-only public key, then encrypts and decrypts JSON payloads with AES-256-GCM.

Each ciphertext is independent: a fresh 12-byte IV is generated per message and
prepended to the AES-GCM output, so the same shared key can be reused safely
across many messages without IV reuse.

In a two-party model, successful AES-GCM decryption with a key derived from
ECDH(myPrivKey, theirPubKey) is sufficient to authenticate the sender — the
only other entity that could have produced the ciphertext is the recipient.
*/

import { deriveSharedSecretXHex, normalizePublicKeyHex } from "../utils/nostr-keys.js";

const AES_KEY_BITS = 256;
const AES_IV_BYTES = 12;
const subtle = window.crypto?.subtle;

const sharedKeyCache = new Map();

const hexToBytes = (hexValue) => {
  const cleanHex = hexValue.length % 2 === 0 ? hexValue : `0${hexValue}`;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    bytes[byteIndex] = parseInt(cleanHex.slice(byteIndex * 2, byteIndex * 2 + 2), 16);
  }
  return bytes;
};

const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    binary += String.fromCharCode(bytes[byteIndex]);
  }
  return window.btoa(binary);
};

const base64ToBytes = (encoded) => {
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let charIndex = 0; charIndex < binary.length; charIndex += 1) {
    bytes[charIndex] = binary.charCodeAt(charIndex);
  }
  return bytes;
};

const concatBytes = (left, right) => {
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left, 0);
  combined.set(right, left.length);
  return combined;
};

const normalizePeerPublicKeyHex = (peerPublicKey) => normalizePublicKeyHex(peerPublicKey);

// Derive a 256-bit AES-GCM key from the secp256k1 ECDH shared secret. The
// shared x-coordinate is high-entropy, so a single SHA-256 is enough to spread
// it into a uniform key. Cached per peer to avoid repeating the BigInt-based
// scalar multiplication on every send/receive.
const importPeerKey = async (privateKeyHex, peerPublicKey) => {
  const peerHex = normalizePeerPublicKeyHex(peerPublicKey);
  const cacheKey = `${privateKeyHex}:${peerHex}`;
  const cached = sharedKeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sharedHex = deriveSharedSecretXHex(privateKeyHex, peerHex);
  const sharedBytes = hexToBytes(sharedHex);
  const keyMaterial = await subtle.digest("SHA-256", sharedBytes);
  const cryptoKey = await subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false,
    ["encrypt", "decrypt"]
  );
  sharedKeyCache.set(cacheKey, cryptoKey);
  return cryptoKey;
};

export const encryptForPeer = async (plaintextString, { privateKeyHex, peerPublicKey }) => {
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto is unavailable.");
  }

  const cryptoKey = await importPeerKey(privateKeyHex, peerPublicKey);
  const iv = window.crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const plaintextBytes = new TextEncoder().encode(plaintextString);
  const ciphertextBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    plaintextBytes
  );
  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  return bytesToBase64(concatBytes(iv, ciphertextBytes));
};

export const decryptFromPeer = async (encodedCiphertext, { privateKeyHex, peerPublicKey }) => {
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto is unavailable.");
  }

  const combined = base64ToBytes(encodedCiphertext);
  if (combined.length <= AES_IV_BYTES) {
    throw new Error("Ciphertext is too short to contain an IV.");
  }

  const iv = combined.slice(0, AES_IV_BYTES);
  const ciphertextBytes = combined.slice(AES_IV_BYTES);
  const cryptoKey = await importPeerKey(privateKeyHex, peerPublicKey);
  const plaintextBuffer = await subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertextBytes
  );
  return new TextDecoder().decode(plaintextBuffer);
};
