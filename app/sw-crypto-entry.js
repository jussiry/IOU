/*
Service-worker crypto entry — bundled (esbuild, IIFE) into dist/sw-crypto.js and
pulled into sw.js via importScripts. It exists because the service worker is a
*classic* worker (importScripts, no ESM) and must decrypt Web Push hints that
were encrypted with secp256k1 ECDH — which WebCrypto cannot do (it only supports
the NIST P-curves). The rest of the app reaches the same noble-curves code via
normal ES module imports; the SW can't, so we ship it this one bundled file.

It mirrors crypto/peer-crypto.js's decryptFromPeer, but uses the service-worker
globals (self.crypto.subtle, atob) instead of the window-scoped ones. The shared
secret is the secp256k1 ECDH x-coordinate (noble), hashed with SHA-256 into an
AES-256-GCM key (WebCrypto); the 12-byte IV is prepended to the ciphertext.

Exposes one global: self.__tallyPushCrypto.decryptHint(ciphertextB64,
myPrivateKeyHex, senderPublicKey) -> Promise<string>.
*/

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

const decryptHint = async (ciphertextB64, myPrivateKeyHex, senderPublicKey) => {
  const sharedHex = deriveSharedSecretXHex(myPrivateKeyHex, toPublicKeyHex(senderPublicKey));
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

self.__tallyPushCrypto = { decryptHint };
