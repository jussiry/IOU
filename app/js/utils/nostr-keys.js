/*
Nostr-compatible identity helpers for the IOU client.

Key primitives (random scalar, public-key derivation, ECDH) live in
`crypto/secp256k1.js` on top of the vendored @noble/curves bundle. This module
only owns the surface-level Nostr identity concerns: NIP-19 bech32 encoding
between raw hex and the `npub` / `nsec` formats, plus a small helper that ties
generation + encoding together.
*/

import {
  bytesToHex,
  derivePublicKeyHex,
  deriveSharedSecretXHex as deriveSharedSecretXHexImpl,
  generatePrivateKeyHex,
  hexToBytes,
} from "../crypto/secp256k1.js";

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

// ---------------------------------------------------------------------------
// Bech32 (BIP-173 / NIP-19 flavour) — pure-JS encode/decode. Independent of
// the curve math and small enough to keep inline.
// ---------------------------------------------------------------------------

const bech32Polymod = (values) => {
  const generatorValues = [
    0x3b6a57b2,
    0x26508e6d,
    0x1ea119fa,
    0x3d4233dd,
    0x2a1462b3,
  ];
  let checksum = 1;
  values.forEach((value) => {
    const topBits = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    generatorValues.forEach((generatorValue, index) => {
      if ((topBits >> index) & 1) {
        checksum ^= generatorValue;
      }
    });
  });
  return checksum;
};

const hrpExpand = (humanReadablePart) => {
  const resultValues = [];
  for (let index = 0; index < humanReadablePart.length; index += 1) {
    resultValues.push(humanReadablePart.charCodeAt(index) >> 5);
  }
  resultValues.push(0);
  for (let index = 0; index < humanReadablePart.length; index += 1) {
    resultValues.push(humanReadablePart.charCodeAt(index) & 31);
  }
  return resultValues;
};

const createChecksumWords = (humanReadablePart, dataWords) => {
  const expandedHrp = hrpExpand(humanReadablePart);
  const valuesForChecksum = [...expandedHrp, ...dataWords, 0, 0, 0, 0, 0, 0];
  const polymodResult = bech32Polymod(valuesForChecksum) ^ 1;
  return Array.from({ length: 6 }, (_, checksumIndex) => {
    const shiftAmount = 5 * (5 - checksumIndex);
    return (polymodResult >> shiftAmount) & 31;
  });
};

const verifyChecksumWords = (humanReadablePart, allWords) => {
  const expandedHrp = hrpExpand(humanReadablePart);
  return bech32Polymod([...expandedHrp, ...allWords]) === 1;
};

const convertBits = (inputValues, fromBits, toBits, shouldPad) => {
  let accumulator = 0;
  let bitCount = 0;
  const outputValues = [];
  const maxOutputValue = (1 << toBits) - 1;
  const maxAccumulatorValue = (1 << (fromBits + toBits - 1)) - 1;
  inputValues.forEach((inputValue) => {
    if (inputValue < 0 || inputValue >> fromBits !== 0) {
      throw new Error("Input value exceeds bit-size for conversion.");
    }
    accumulator = ((accumulator << fromBits) | inputValue) & maxAccumulatorValue;
    bitCount += fromBits;
    while (bitCount >= toBits) {
      bitCount -= toBits;
      outputValues.push((accumulator >> bitCount) & maxOutputValue);
    }
  });
  if (shouldPad && bitCount > 0) {
    outputValues.push((accumulator << (toBits - bitCount)) & maxOutputValue);
  } else if (!shouldPad) {
    const hasExcessPadding = bitCount >= fromBits;
    const hasNonZeroPadding = ((accumulator << (toBits - bitCount)) & maxOutputValue) !== 0;
    if (hasExcessPadding || hasNonZeroPadding) {
      throw new Error("Invalid padding during bit conversion.");
    }
  }
  return outputValues;
};

const encodeBech32 = (humanReadablePart, dataWords) => {
  const checksumWords = createChecksumWords(humanReadablePart, dataWords);
  const allWords = [...dataWords, ...checksumWords];
  const encodedWords = allWords.map((word) => BECH32_CHARSET[word]).join("");
  return `${humanReadablePart}1${encodedWords}`;
};

const decodeBech32 = (encodedValue) => {
  if (typeof encodedValue !== "string") {
    throw new Error("Expected a bech32 string.");
  }
  const trimmedValue = encodedValue.trim();
  const normalizedValue = trimmedValue.toLowerCase();
  if (!trimmedValue || trimmedValue !== normalizedValue) {
    throw new Error("Bech32 value must be lowercase.");
  }
  const separatorIndex = normalizedValue.lastIndexOf("1");
  if (separatorIndex <= 0 || separatorIndex + 7 > normalizedValue.length) {
    throw new Error("Invalid bech32 separator position.");
  }
  const humanReadablePart = normalizedValue.slice(0, separatorIndex);
  const encodedWords = normalizedValue.slice(separatorIndex + 1);
  const allWords = Array.from(encodedWords, (character) => {
    const index = BECH32_CHARSET.indexOf(character);
    if (index === -1) {
      throw new Error("Bech32 value contains invalid characters.");
    }
    return index;
  });
  if (!verifyChecksumWords(humanReadablePart, allWords)) {
    throw new Error("Bech32 checksum verification failed.");
  }
  return {
    humanReadablePart,
    dataWords: allWords.slice(0, -6),
  };
};

const encodeNip19Key = (humanReadablePart, keyHex) => {
  const keyBytes = hexToBytes(keyHex);
  const fiveBitWords = convertBits(Array.from(keyBytes), 8, 5, true);
  return encodeBech32(humanReadablePart, fiveBitWords);
};

const decodeNip19Key = (encodedValue, expectedHrp) => {
  const { humanReadablePart, dataWords } = decodeBech32(encodedValue);
  if (humanReadablePart !== expectedHrp) {
    throw new Error(`Expected a ${expectedHrp}-encoded key.`);
  }
  const decodedBytes = convertBits(dataWords, 5, 8, false);
  if (decodedBytes.length !== 32) {
    throw new Error(`Invalid ${expectedHrp} payload length.`);
  }
  return bytesToHex(new Uint8Array(decodedBytes));
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const isValidNsec = (encodedValue) => {
  try {
    decodeNip19Key(encodedValue, "nsec");
    return true;
  } catch {
    return false;
  }
};

export const isValidNpub = (encodedValue) => {
  try {
    decodeNip19Key(encodedValue, "npub");
    return true;
  } catch {
    return false;
  }
};

export const decodeNsecToHex = (encodedValue) => decodeNip19Key(encodedValue, "nsec");
export const decodeNpubToHex = (encodedValue) => decodeNip19Key(encodedValue, "npub");

export const encodeNpubFromPublicKeyHex = (publicKeyHex) => encodeNip19Key("npub", publicKeyHex);
export const encodeNsecFromPrivateKeyHex = (privateKeyHex) => encodeNip19Key("nsec", privateKeyHex);

export const deriveNostrPublicKeyHex = (privateKeyHex) => derivePublicKeyHex(privateKeyHex);

export const deriveSharedSecretXHex = (privateKeyHex, peerPublicKeyHex) =>
  deriveSharedSecretXHexImpl(privateKeyHex, peerPublicKeyHex);

// ---------------------------------------------------------------------------
// Generic bech32 byte encode/decode — used by NIP-49 (ncryptsec) which packs
// a 91-byte binary payload rather than a 32-byte key. Exported here rather
// than duplicated so the same bech32 implementation covers every format.
// ---------------------------------------------------------------------------

export const encodeBech32FromBytes = (humanReadablePart, bytes) => {
  const fiveBitWords = convertBits(Array.from(bytes), 8, 5, true);
  return encodeBech32(humanReadablePart, fiveBitWords);
};

export const decodeBech32ToBytes = (encodedValue, expectedHrp) => {
  const { humanReadablePart, dataWords } = decodeBech32(encodedValue);
  if (humanReadablePart !== expectedHrp) {
    throw new Error(`Expected a ${expectedHrp}-encoded value.`);
  }
  const decodedBytes = convertBits(dataWords, 5, 8, false);
  return new Uint8Array(decodedBytes);
};

export const generateNostrKeyPair = () => {
  const privateKeyHex = generatePrivateKeyHex();
  const publicKeyHex = derivePublicKeyHex(privateKeyHex);
  return {
    privateKeyHex,
    privateKeyNsec: encodeNsecFromPrivateKeyHex(privateKeyHex),
    publicKeyHex,
    publicKeyNpub: encodeNpubFromPublicKeyHex(publicKeyHex),
  };
};
