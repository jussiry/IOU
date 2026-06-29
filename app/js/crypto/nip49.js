/*
NIP-49 (ncryptsec) — passphrase-encrypted private key encoding.

Spec: https://github.com/nostr-protocol/nips/blob/master/49.md

Used for "Transfer to another device" and for logging into an existing user
from a passphrase + encrypted blob on the welcome page. The blob is a static
bech32 string with hrp "ncryptsec"; decrypting the same blob with the same
passphrase always yields the same private key, so a user can also keep it as
a long-term recovery backup.

Wire format (91 bytes total, before bech32 encoding):
  version              1 byte   (0x02)
  log_n                1 byte   (scrypt N exponent; we use 16 → N=2^16)
  salt                16 bytes  (scrypt salt)
  nonce               24 bytes  (XChaCha20 nonce)
  key_security_byte    1 byte   (0x00 known / 0x01 unknown / 0x02 client does not track)
  ciphertext+tag      48 bytes  (32-byte private key + 16-byte Poly1305 tag)

Encryption:
  key         = scrypt(NFKC(passphrase), salt, N=2^log_n, r=8, p=1, dkLen=32)
  ciphertext  = xchacha20poly1305(key, nonce, AAD=[key_security_byte]).encrypt(privKey)

Decryption reverses the above and relies on Poly1305 authentication: a wrong
passphrase produces a tag mismatch and throws — no key material is returned.
@category crypto
*/

import { scrypt } from "../vendor/noble-scrypt.js";
import { xchacha20poly1305 } from "../vendor/noble-chacha.js";
import { hexToBytes, bytesToHex } from "./secp256k1.js";
import {
  encodeBech32FromBytes,
  decodeBech32ToBytes,
} from "../utils/nostr-keys.js";

const NCRYPTSEC_HRP = "ncryptsec";

const VERSION_BYTE = 0x02;
const DEFAULT_LOG_N = 16; // scrypt cost — ~128 MB per attempt, ~1s on a laptop
const SALT_LEN = 16;
const NONCE_LEN = 24;
const KEY_LEN = 32;
const TAG_LEN = 16;
const PAYLOAD_LEN = 1 + 1 + SALT_LEN + NONCE_LEN + 1 + KEY_LEN + TAG_LEN; // 91

const KEY_SECURITY_UNKNOWN = 0x01;

// NIP-49 requires UTF-8 bytes of the NFKC-normalized passphrase. Any surrogate
// or whitespace handling is the caller's problem — the spec is byte-exact.
const passphraseToBytes = (passphrase) => {
  const normalized = String(passphrase || "").normalize("NFKC");
  return new TextEncoder().encode(normalized);
};

const randomBytes = (length) => {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
};

const deriveScryptKey = (passphrase, salt, logN) => {
  return scrypt(passphraseToBytes(passphrase), salt, {
    N: 1 << logN,
    r: 8,
    p: 1,
    dkLen: KEY_LEN,
  });
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const encryptNcryptsec = (privateKeyHex, passphrase, options = {}) => {
  const logN = Number.isInteger(options.logN) ? options.logN : DEFAULT_LOG_N;
  const keySecurityByte = Number.isInteger(options.keySecurityByte)
    ? options.keySecurityByte
    : KEY_SECURITY_UNKNOWN;

  const privateKeyBytes = hexToBytes(privateKeyHex);
  if (privateKeyBytes.length !== KEY_LEN) {
    throw new Error("NIP-49: private key must be 32 bytes.");
  }

  const salt = randomBytes(SALT_LEN);
  const nonce = randomBytes(NONCE_LEN);
  const derivedKey = deriveScryptKey(passphrase, salt, logN);

  const aad = new Uint8Array([keySecurityByte]);
  const cipher = xchacha20poly1305(derivedKey, nonce, aad);
  const ciphertextWithTag = cipher.encrypt(privateKeyBytes);

  const payload = new Uint8Array(PAYLOAD_LEN);
  let offset = 0;
  payload[offset++] = VERSION_BYTE;
  payload[offset++] = logN;
  payload.set(salt, offset); offset += SALT_LEN;
  payload.set(nonce, offset); offset += NONCE_LEN;
  payload[offset++] = keySecurityByte;
  payload.set(ciphertextWithTag, offset);

  return encodeBech32FromBytes(NCRYPTSEC_HRP, payload);
};

export const decryptNcryptsec = (ncryptsec, passphrase) => {
  let payload;
  try {
    payload = decodeBech32ToBytes(String(ncryptsec || "").trim().toLowerCase(), NCRYPTSEC_HRP);
  } catch (error) {
    throw new Error("Invalid ncryptsec format.");
  }
  if (payload.length !== PAYLOAD_LEN) {
    throw new Error("Invalid ncryptsec payload length.");
  }

  let offset = 0;
  const version = payload[offset++];
  if (version !== VERSION_BYTE) {
    throw new Error(`Unsupported ncryptsec version: 0x${version.toString(16)}`);
  }
  const logN = payload[offset++];
  const salt = payload.slice(offset, offset + SALT_LEN); offset += SALT_LEN;
  const nonce = payload.slice(offset, offset + NONCE_LEN); offset += NONCE_LEN;
  const keySecurityByte = payload[offset++];
  const ciphertextWithTag = payload.slice(offset);

  const derivedKey = deriveScryptKey(passphrase, salt, logN);
  const aad = new Uint8Array([keySecurityByte]);
  const cipher = xchacha20poly1305(derivedKey, nonce, aad);

  let privateKeyBytes;
  try {
    privateKeyBytes = cipher.decrypt(ciphertextWithTag);
  } catch (error) {
    // Poly1305 tag mismatch → almost certainly wrong passphrase.
    throw new Error("Incorrect passphrase.");
  }
  if (privateKeyBytes.length !== KEY_LEN) {
    throw new Error("Decrypted key has unexpected length.");
  }
  return bytesToHex(privateKeyBytes);
};

export const isValidNcryptsec = (value) => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith(`${NCRYPTSEC_HRP}1`)) return false;
  try {
    const bytes = decodeBech32ToBytes(trimmed, NCRYPTSEC_HRP);
    return bytes.length === PAYLOAD_LEN && bytes[0] === VERSION_BYTE;
  } catch {
    return false;
  }
};
