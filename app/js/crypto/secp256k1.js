/*
Thin wrapper around the vendored @noble/curves secp256k1 bundle. Exposes the
operations the IOU client needs — key generation, x-only public-key derivation,
ECDH shared-secret derivation, and Schnorr (BIP-340) sign/verify — in terms of
hex strings, matching the representation already used throughout the codebase.

Nostr-style keys are x-only (32-byte) on the wire. For ECDH noble requires a
prefixed compressed key, so we prepend 0x02 (BIP-340 even-y convention) before
delegating. For Schnorr noble operates on x-only directly, so no conversion is
needed.

The module is intentionally byte/hex-focused and carries no state; callers pass
key material explicitly so the crypto primitives stay easy to audit.
@category crypto
*/

import { secp256k1, schnorr } from "../vendor/noble-secp256k1.js";

const HEX_BYTE_LEN = 32;

const normalizeHex = (value, expectedByteLength = HEX_BYTE_LEN) => {
  if (typeof value !== "string") {
    throw new Error("Expected a hex string.");
  }
  const trimmed = value.trim().toLowerCase();
  const withoutPrefix = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]*$/.test(withoutPrefix)) {
    throw new Error("Invalid hex string.");
  }
  const expectedLen = expectedByteLength * 2;
  const padded = withoutPrefix.padStart(expectedLen, "0");
  if (padded.length !== expectedLen) {
    throw new Error("Hex value has invalid length.");
  }
  return padded;
};

export const hexToBytes = (hexValue, expectedByteLength = HEX_BYTE_LEN) => {
  const hex = normalizeHex(hexValue, expectedByteLength);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

export const bytesToHex = (bytes) => {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("Expected a Uint8Array.");
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
};

// Prepend the BIP-340 even-y prefix to turn an x-only (32-byte) key into a
// compressed (33-byte) key suitable for non-Schnorr noble APIs.
const xOnlyToCompressed = (xOnlyBytes) => {
  if (xOnlyBytes.length !== 32) {
    throw new Error("x-only public key must be 32 bytes.");
  }
  const compressed = new Uint8Array(33);
  compressed[0] = 0x02;
  compressed.set(xOnlyBytes, 1);
  return compressed;
};

export const generatePrivateKeyHex = () => {
  return bytesToHex(schnorr.utils.randomPrivateKey());
};

// Derive the x-only (BIP-340) public key from a private key. Matches how
// Nostr serializes public keys everywhere in this codebase.
export const derivePublicKeyHex = (privateKeyHex) => {
  const privBytes = hexToBytes(privateKeyHex);
  return bytesToHex(schnorr.getPublicKey(privBytes));
};

// ECDH shared secret x-coordinate between our private key and a peer's x-only
// public key. Matches the Nostr/NIP-44 convention of dropping the prefix byte
// and using just the 32-byte x coordinate as the shared-secret input.
export const deriveSharedSecretXHex = (privateKeyHex, peerPublicKeyHex) => {
  const privBytes = hexToBytes(privateKeyHex);
  const peerXOnly = hexToBytes(peerPublicKeyHex);
  const compressedPeer = xOnlyToCompressed(peerXOnly);
  // `true` → compressed output; noble returns 33 bytes (prefix + x). Drop the
  // prefix to get the raw x-coordinate.
  const shared = secp256k1.getSharedSecret(privBytes, compressedPeer, true);
  return bytesToHex(shared.slice(1));
};

// Sign a 32-byte digest with Schnorr (BIP-340). Callers must pre-hash their
// payload to 32 bytes; signing arbitrary-length data is refused by noble.
export const schnorrSignHex = (messageHashHex, privateKeyHex) => {
  const msgBytes = hexToBytes(messageHashHex);
  const privBytes = hexToBytes(privateKeyHex);
  return bytesToHex(schnorr.sign(msgBytes, privBytes));
};

export const schnorrVerifyHex = (signatureHex, messageHashHex, publicKeyHex) => {
  try {
    const sigBytes = hexToBytes(signatureHex, 64);
    const msgBytes = hexToBytes(messageHashHex);
    const pubBytes = hexToBytes(publicKeyHex);
    return schnorr.verify(sigBytes, msgBytes, pubBytes);
  } catch {
    return false;
  }
};

// SHA-256 over a UTF-8 string, returning hex. Used for pre-hashing the
// canonical message representation before Schnorr signing.
export const sha256HexOfString = async (input) => {
  const encoded = new TextEncoder().encode(input);
  const digest = await window.crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
};
