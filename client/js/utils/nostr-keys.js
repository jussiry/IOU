/*
This module implements the key primitives needed for Nostr-compatible identities in the IOU client. It generates secp256k1 private keys, derives x-only public keys, and encodes keys into NIP-19 bech32 formats (`npub` and `nsec`).

The implementation intentionally keeps all key-shape logic in one place so the rest of the app can treat identity creation as a simple utility call and store consistent key fields in IndexedDB.
*/

const FIELD_PRIME = BigInt(
  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F"
);
const GROUP_ORDER = BigInt(
  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"
);
const GENERATOR_POINT = {
  pointX: BigInt(
    "0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798"
  ),
  pointY: BigInt(
    "0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8"
  ),
};

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

const normalizeModulo = (value, modulo) => {
  const remainder = value % modulo;
  return remainder >= 0n ? remainder : remainder + modulo;
};

const modInverse = (value, modulo) => {
  const normalizedValue = normalizeModulo(value, modulo);
  if (normalizedValue === 0n) {
    throw new Error("Cannot invert zero in modular arithmetic.");
  }

  let previousRemainder = modulo;
  let currentRemainder = normalizedValue;
  let previousCoefficient = 0n;
  let currentCoefficient = 1n;

  while (currentRemainder !== 0n) {
    const quotient = previousRemainder / currentRemainder;
    const nextRemainder = previousRemainder - quotient * currentRemainder;
    const nextCoefficient = previousCoefficient - quotient * currentCoefficient;

    previousRemainder = currentRemainder;
    currentRemainder = nextRemainder;
    previousCoefficient = currentCoefficient;
    currentCoefficient = nextCoefficient;
  }

  if (previousRemainder !== 1n) {
    throw new Error("Value has no modular inverse.");
  }

  return normalizeModulo(previousCoefficient, modulo);
};

const doublePoint = (point) => {
  if (!point) return null;
  if (point.pointY === 0n) return null;

  const slopeNumerator = normalizeModulo(
    3n * point.pointX * point.pointX,
    FIELD_PRIME
  );
  const slopeDenominator = normalizeModulo(2n * point.pointY, FIELD_PRIME);
  const slope = normalizeModulo(
    slopeNumerator * modInverse(slopeDenominator, FIELD_PRIME),
    FIELD_PRIME
  );

  const resultPointX = normalizeModulo(
    slope * slope - 2n * point.pointX,
    FIELD_PRIME
  );
  const resultPointY = normalizeModulo(
    slope * (point.pointX - resultPointX) - point.pointY,
    FIELD_PRIME
  );

  return {
    pointX: resultPointX,
    pointY: resultPointY,
  };
};

const addPoints = (leftPoint, rightPoint) => {
  if (!leftPoint) return rightPoint;
  if (!rightPoint) return leftPoint;

  if (leftPoint.pointX === rightPoint.pointX) {
    const ySum = normalizeModulo(leftPoint.pointY + rightPoint.pointY, FIELD_PRIME);
    if (ySum === 0n) return null;
    return doublePoint(leftPoint);
  }

  const slopeNumerator = normalizeModulo(
    rightPoint.pointY - leftPoint.pointY,
    FIELD_PRIME
  );
  const slopeDenominator = normalizeModulo(
    rightPoint.pointX - leftPoint.pointX,
    FIELD_PRIME
  );
  const slope = normalizeModulo(
    slopeNumerator * modInverse(slopeDenominator, FIELD_PRIME),
    FIELD_PRIME
  );

  const resultPointX = normalizeModulo(
    slope * slope - leftPoint.pointX - rightPoint.pointX,
    FIELD_PRIME
  );
  const resultPointY = normalizeModulo(
    slope * (leftPoint.pointX - resultPointX) - leftPoint.pointY,
    FIELD_PRIME
  );

  return {
    pointX: resultPointX,
    pointY: resultPointY,
  };
};

const multiplyGenerator = (scalar) => {
  if (scalar <= 0n || scalar >= GROUP_ORDER) {
    throw new Error("Scalar is outside secp256k1 valid range.");
  }

  let remainingScalar = scalar;
  let accumulatedPoint = null;
  let doublingPoint = GENERATOR_POINT;

  while (remainingScalar > 0n) {
    const currentBit = remainingScalar & 1n;
    if (currentBit === 1n) {
      accumulatedPoint = addPoints(accumulatedPoint, doublingPoint);
    }
    doublingPoint = doublePoint(doublingPoint);
    remainingScalar >>= 1n;
  }

  if (!accumulatedPoint) {
    throw new Error("Unable to derive public key point.");
  }

  return accumulatedPoint;
};

const bytesToHex = (bytes) => {
  return Array.from(bytes, (byteValue) => byteValue.toString(16).padStart(2, "0")).join("");
};

const normalizeHex = (value, expectedByteLength) => {
  if (typeof value !== "string") {
    throw new Error("Expected a hex string.");
  }

  const trimmedValue = value.trim().toLowerCase();
  const withoutPrefix = trimmedValue.startsWith("0x")
    ? trimmedValue.slice(2)
    : trimmedValue;

  if (!/^[0-9a-f]+$/.test(withoutPrefix)) {
    throw new Error("Invalid hex string.");
  }

  const expectedLength = expectedByteLength * 2;
  const paddedHex = withoutPrefix.padStart(expectedLength, "0");
  if (paddedHex.length !== expectedLength) {
    throw new Error("Hex value has invalid length.");
  }

  return paddedHex;
};

const hexToBytes = (hexValue) => {
  const normalizedHex = normalizeHex(hexValue, hexValue.length / 2);
  const bytes = new Uint8Array(normalizedHex.length / 2);
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    const startIndex = byteIndex * 2;
    bytes[byteIndex] = Number.parseInt(
      normalizedHex.slice(startIndex, startIndex + 2),
      16
    );
  }
  return bytes;
};

const bytesToBigInt = (bytes) => {
  const hexValue = bytesToHex(bytes);
  return BigInt(`0x${hexValue}`);
};

const bigIntToFixedHex = (value, byteLength = 32) => {
  return value.toString(16).padStart(byteLength * 2, "0");
};

const createRandomPrivateScalar = () => {
  while (true) {
    const candidateBytes = new Uint8Array(32);
    window.crypto.getRandomValues(candidateBytes);
    const candidateScalar = bytesToBigInt(candidateBytes);
    if (candidateScalar > 0n && candidateScalar < GROUP_ORDER) {
      return candidateScalar;
    }
  }
};

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
  const encodedWords = allWords
    .map((word) => BECH32_CHARSET[word])
    .join("");
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
  const normalizedHex = normalizeHex(keyHex, 32);
  const keyBytes = hexToBytes(normalizedHex);
  const fiveBitWords = convertBits(Array.from(keyBytes), 8, 5, true);
  return encodeBech32(humanReadablePart, fiveBitWords);
};

export const isValidNsec = (encodedValue) => {
  try {
    const { humanReadablePart, dataWords } = decodeBech32(encodedValue);
    if (humanReadablePart !== "nsec") {
      return false;
    }

    const decodedBytes = convertBits(dataWords, 5, 8, false);
    if (decodedBytes.length !== 32) {
      return false;
    }

    const scalar = BigInt(`0x${bytesToHex(new Uint8Array(decodedBytes))}`);
    return scalar > 0n && scalar < GROUP_ORDER;
  } catch (error) {
    return false;
  }
};

export const decodeNsecToHex = (encodedValue) => {
  const { humanReadablePart, dataWords } = decodeBech32(encodedValue);
  if (humanReadablePart !== "nsec") {
    throw new Error("Expected an nsec-encoded private key.");
  }

  const decodedBytes = convertBits(dataWords, 5, 8, false);
  if (decodedBytes.length !== 32) {
    throw new Error("Invalid nsec payload length.");
  }

  return bytesToHex(new Uint8Array(decodedBytes));
};

export const isValidNpub = (encodedValue) => {
  try {
    const { humanReadablePart, dataWords } = decodeBech32(encodedValue);
    if (humanReadablePart !== "npub") {
      return false;
    }

    const decodedBytes = convertBits(dataWords, 5, 8, false);
    return decodedBytes.length === 32;
  } catch (error) {
    return false;
  }
};

export const encodeNpubFromPublicKeyHex = (publicKeyHex) => {
  return encodeNip19Key("npub", publicKeyHex);
};

export const encodeNsecFromPrivateKeyHex = (privateKeyHex) => {
  return encodeNip19Key("nsec", privateKeyHex);
};

export const deriveNostrPublicKeyHex = (privateKeyHex) => {
  const normalizedPrivateHex = normalizeHex(privateKeyHex, 32);
  const privateScalar = BigInt(`0x${normalizedPrivateHex}`);
  if (privateScalar <= 0n || privateScalar >= GROUP_ORDER) {
    throw new Error("Private key scalar is outside secp256k1 range.");
  }

  const publicPoint = multiplyGenerator(privateScalar);
  return bigIntToFixedHex(publicPoint.pointX, 32);
};

export const generateNostrKeyPair = () => {
  const privateScalar = createRandomPrivateScalar();
  const privateKeyHex = bigIntToFixedHex(privateScalar, 32);
  const publicKeyHex = deriveNostrPublicKeyHex(privateKeyHex);

  return {
    privateKeyHex,
    privateKeyNsec: encodeNsecFromPrivateKeyHex(privateKeyHex),
    publicKeyHex,
    publicKeyNpub: encodeNpubFromPublicKeyHex(publicKeyHex),
  };
};
