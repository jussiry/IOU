/*
NIP-44 v2 encryption for Tally peer envelopes (and the encrypted push hints).

This is a faithful port of the reference `nostr-tools` NIP-44 v2 implementation:
secp256k1 ECDH -> HKDF-SHA256 conversation key -> per-message HKDF expansion into
ChaCha20 key/nonce + HMAC key, ChaCha20 encryption of a length-hidden padded
plaintext, and an HMAC-SHA256 over (nonce || ciphertext). We deliberately do NOT
re-derive the padding or MAC logic by hand — the algorithm and its constants come
straight from the spec so the official NIP-44 test vectors pass unchanged.

Crypto primitives come from the vendored noble bundles (chacha20, sha256, hmac,
hkdf) plus the existing secp256k1 ECDH wrapper, so this module works identically
in the window context and in the classic service worker (no WebCrypto, no DOM).

The unit of reuse is the per-peer *conversation key*: derive it once with
`getConversationKey` and cache it, exactly as the legacy AES path cached its
derived key, so steady-state cost matches the previous scheme.
*/

import { chacha20 } from "../vendor/noble-chacha.js";
import { sha256, hmac, hkdfExtract, hkdfExpand } from "../vendor/noble-hashes.js";
import { deriveSharedSecretXHex, hexToBytes } from "./secp256k1.js";

const MIN_PLAINTEXT_SIZE = 1; // 1 byte  -> padded to 32
const MAX_PLAINTEXT_SIZE = 0xffff; // 65535 bytes (64 KiB - 1)
const NIP44_SALT = new TextEncoder().encode("nip44-v2");
const VERSION = 2;

const utf8Encode = (text) => new TextEncoder().encode(text);
const utf8Decode = (bytes) => new TextDecoder().decode(bytes);

const concatBytes = (...arrays) => {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
};

const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return globalThis.btoa(binary);
};

const base64ToBytes = (encoded) => {
  const binary = globalThis.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// Constant-time comparison so MAC verification doesn't leak via timing.
const equalBytes = (left, right) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
};

const randomBytes = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));

// Derive the long-lived conversation key for a pair of keys. `privateKeyHex` is
// the local secret; `peerPublicKeyHex` is the peer's x-only public key (hex).
// The shared X coordinate is the ECDH secret; HKDF-extract with the fixed
// "nip44-v2" salt spreads it into the 32-byte conversation key.
export const getConversationKey = (privateKeyHex, peerPublicKeyHex) => {
  const sharedX = hexToBytes(deriveSharedSecretXHex(privateKeyHex, peerPublicKeyHex));
  return hkdfExtract(sha256, sharedX, NIP44_SALT);
};

// Expand the conversation key + per-message nonce into the three keys a single
// message needs.
const getMessageKeys = (conversationKey, nonce) => {
  const keys = hkdfExpand(sha256, conversationKey, nonce, 76);
  // Use slice (copy) rather than subarray (view): the vendored chacha20 reads a
  // key/nonce from offset 0 of its backing buffer, so a non-zero byteOffset view
  // would silently use the wrong bytes. Copies are zero-offset and safe.
  return {
    chachaKey: keys.slice(0, 32),
    chachaNonce: keys.slice(32, 44),
    hmacKey: keys.slice(44, 76),
  };
};

// NIP-44 length-hiding padding: round the plaintext up to a power-of-two-ish
// bucket so ciphertext length leaks only the bucket, not the exact size.
const calcPaddedLen = (length) => {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new Error("Expected a positive integer length.");
  }
  if (length <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(length - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((length - 1) / chunk) + 1);
};

const writeLengthPrefix = (length) => {
  if (length < MIN_PLAINTEXT_SIZE || length > MAX_PLAINTEXT_SIZE) {
    throw new Error("Invalid plaintext size: must be 1..65535 bytes.");
  }
  const prefix = new Uint8Array(2);
  new DataView(prefix.buffer).setUint16(0, length, false);
  return prefix;
};

const pad = (plaintext) => {
  const unpadded = utf8Encode(plaintext);
  const suffix = new Uint8Array(calcPaddedLen(unpadded.length) - unpadded.length);
  return concatBytes(writeLengthPrefix(unpadded.length), unpadded, suffix);
};

const unpad = (padded) => {
  const unpaddedLen = new DataView(padded.buffer, padded.byteOffset).getUint16(0, false);
  const unpadded = padded.subarray(2, 2 + unpaddedLen);
  if (
    unpaddedLen < MIN_PLAINTEXT_SIZE ||
    unpaddedLen > MAX_PLAINTEXT_SIZE ||
    unpadded.length !== unpaddedLen ||
    padded.length !== 2 + calcPaddedLen(unpaddedLen)
  ) {
    throw new Error("Invalid NIP-44 padding.");
  }
  return utf8Decode(unpadded);
};

const hmacWithAad = (key, message, aad) => {
  if (aad.length !== 32) throw new Error("AAD must be 32 bytes.");
  return hmac(sha256, key, concatBytes(aad, message));
};

const decodePayload = (payload) => {
  if (typeof payload !== "string" || !payload) {
    throw new Error("NIP-44 payload must be a non-empty string.");
  }
  if (payload[0] === "#") throw new Error("Unsupported NIP-44 encoding.");
  const data = base64ToBytes(payload);
  if (data.length < 99) throw new Error("NIP-44 payload too short.");
  if (data[0] !== VERSION) throw new Error(`Unsupported NIP-44 version ${data[0]}.`);
  return {
    nonce: data.subarray(1, 33),
    ciphertext: data.subarray(33, data.length - 32),
    mac: data.subarray(data.length - 32),
  };
};

// Encrypt with a precomputed conversation key. `nonce` is exposed only so the
// test vectors (which fix the nonce) can be reproduced; production always uses
// a fresh random 32-byte nonce.
export const encryptWithKey = (plaintext, conversationKey, nonce = randomBytes(32)) => {
  const { chachaKey, chachaNonce, hmacKey } = getMessageKeys(conversationKey, nonce);
  const ciphertext = chacha20(chachaKey, chachaNonce, pad(plaintext));
  const mac = hmacWithAad(hmacKey, ciphertext, nonce);
  return bytesToBase64(concatBytes(new Uint8Array([VERSION]), nonce, ciphertext, mac));
};

export const decryptWithKey = (payload, conversationKey) => {
  const { nonce, ciphertext, mac } = decodePayload(payload);
  const { chachaKey, chachaNonce, hmacKey } = getMessageKeys(conversationKey, nonce);
  if (!equalBytes(hmacWithAad(hmacKey, ciphertext, nonce), mac)) {
    throw new Error("Invalid NIP-44 MAC.");
  }
  return unpad(chacha20(chachaKey, chachaNonce, ciphertext));
};

// Convenience wrappers that derive the conversation key per call. Prefer the
// *WithKey variants plus a cached conversation key on hot paths.
export const encrypt = (plaintext, { privateKeyHex, peerPublicKeyHex }) =>
  encryptWithKey(plaintext, getConversationKey(privateKeyHex, peerPublicKeyHex));

export const decrypt = (payload, { privateKeyHex, peerPublicKeyHex }) =>
  decryptWithKey(payload, getConversationKey(privateKeyHex, peerPublicKeyHex));
