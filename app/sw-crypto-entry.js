/*
Service-worker crypto entry — bundled (esbuild, IIFE) into dist/sw-crypto.js and
pulled into sw.js via importScripts. It exists because the service worker is a
*classic* worker (importScripts, no ESM) and must decrypt Web Push hints that
were encrypted with secp256k1 ECDH — which WebCrypto cannot do (it only supports
the NIST P-curves). The rest of the app reaches the same noble-curves code via
normal ES module imports; the SW can't, so we ship it this one bundled file.

Push hints now travel as NIP-44 v2 (matching peer envelope v3). crypto/nip44.js
is deliberately WebCrypto-free and globalThis-based, so it runs unchanged inside
the classic worker. We still accept the legacy AES-GCM path so hints queued
before the sender upgraded can be drained: a NIP-44 payload starts with the
version byte 0x02 once base64-decoded, while the old AES path prepended a random
12-byte IV — so we try NIP-44 first and fall back to AES-GCM on failure.

Exposes one global: self.__tallyPushCrypto.decryptHint(ciphertextB64,
myPrivateKeyHex, senderPublicKey) -> Promise<string>.
*/

import { decryptWithKey, getConversationKey } from "./js/crypto/nip44.js";
import { deriveSharedSecretXHex, hexToBytes } from "./js/crypto/secp256k1.js";
import { decodeNpubToHex } from "./js/utils/nostr-keys.js";

const AES_IV_BYTES = 12;

const base64ToBytes = (encoded) => {
  const binary = self.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const toPublicKeyHex = (userId) => {
  const trimmed = typeof userId === "string" ? userId.trim() : "";
  if (!trimmed) throw new Error("Sender public key is required.");
  return trimmed.startsWith("npub1") ? decodeNpubToHex(trimmed) : trimmed.toLowerCase();
};

// Legacy AES-GCM hint decrypt — secp256k1 ECDH x-coordinate hashed into an
// AES-256-GCM key, 12-byte IV prepended. Kept only to drain pre-upgrade hints.
const decryptHintAes = async (ciphertextB64, myPrivateKeyHex, senderHex) => {
  const sharedHex = deriveSharedSecretXHex(myPrivateKeyHex, senderHex);
  const keyMaterial = await self.crypto.subtle.digest("SHA-256", hexToBytes(sharedHex));
  const cryptoKey = await self.crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const combined = base64ToBytes(ciphertextB64);
  if (combined.length <= AES_IV_BYTES) {
    throw new Error("Ciphertext is too short to contain an IV.");
  }
  const iv = combined.slice(0, AES_IV_BYTES);
  const ciphertext = combined.slice(AES_IV_BYTES);
  const plaintext = await self.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
};

const decryptHint = async (ciphertextB64, myPrivateKeyHex, senderPublicKey) => {
  const senderHex = toPublicKeyHex(senderPublicKey);
  try {
    const conversationKey = getConversationKey(myPrivateKeyHex, senderHex);
    return decryptWithKey(ciphertextB64, conversationKey);
  } catch {
    // Fall back to the legacy AES-GCM path for hints encrypted before the
    // sender upgraded to NIP-44.
    return decryptHintAes(ciphertextB64, myPrivateKeyHex, senderHex);
  }
};

self.__tallyPushCrypto = { decryptHint };
