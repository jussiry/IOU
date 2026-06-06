/*
NIP-44 v2 conformance test for app/js/crypto/nip44.js.

Runs the official NIP-44 test vectors (vendored alongside this file from
https://github.com/paulmillr/nip44) against Tally's implementation: conversation
key derivation, fixed-nonce encryption, decryption, and rejection of malformed /
tampered payloads. This is the authoritative correctness check for the crypto
that backs envelope v3 and the encrypted push hints — run it after touching the
NIP-44 module, the vendored noble bundles, or the secp256k1 ECDH wrapper.

Usage: node tests/nip44/run.mjs   (or: npm run test:nip44)
*/

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  getConversationKey,
  encryptWithKey,
  decryptWithKey,
} from "../../app/js/crypto/nip44.js";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, "nip44.vectors.json"), "utf8")).v2;
const toHex = (bytes) => Buffer.from(bytes).toString("hex");
const fromHex = (hex) => new Uint8Array(Buffer.from(hex, "hex"));

let passed = 0;
let failed = 0;
const expect = (name, got, want) => {
  if (got === want) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}\n  got  ${got}\n  want ${want}`);
  }
};

for (const [i, t] of vectors.valid.get_conversation_key.entries()) {
  expect(`conv_key[${i}]`, toHex(getConversationKey(t.sec1, t.pub2)), t.conversation_key);
}

for (const [i, t] of vectors.valid.encrypt_decrypt.entries()) {
  const key = fromHex(t.conversation_key);
  expect(`encrypt[${i}]`, encryptWithKey(t.plaintext, key, fromHex(t.nonce)), t.payload);
  expect(`decrypt[${i}]`, decryptWithKey(t.payload, key), t.plaintext);
}

for (const [i, t] of (vectors.invalid.decrypt || []).entries()) {
  let threw = false;
  try {
    decryptWithKey(t.payload, fromHex(t.conversation_key));
  } catch {
    threw = true;
  }
  expect(`invalid_decrypt_rejected[${i}]`, String(threw), "true");
}

console.log(`\nNIP-44 vectors: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
