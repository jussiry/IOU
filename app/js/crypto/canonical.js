/*
Canonical serialization for peer messages and ledger entries.

Signing requires a deterministic byte representation of the signed content so
that the sender and receiver produce identical digests. We use a
JSON-canonicalization approach: sort object keys recursively before
stringifying. Arrays preserve order; scalars pass through untouched.

Only the fields that define the message's semantic identity are included in
the digest — the `signature` field itself is deliberately excluded so the
signature can live alongside the signed content without self-referencing.
@category crypto
*/

const canonicalize = (value) => {
  if (value === null || value === undefined) {
    return value === undefined ? null : value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object") {
    const sorted = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        sorted[key] = canonicalize(value[key]);
      });
    return sorted;
  }
  return value;
};

// Produce the canonical JSON string used as the Schnorr message pre-image for
// both peer messages (inner, pre-encryption) and ledger entries during sync.
export const canonicalJsonForSigning = (input) => {
  const fields = {
    id: input?.id || "",
    type: input?.type || "",
    from_user_id: input?.from_user_id || "",
    to_user_id: input?.to_user_id || "",
    created_at: input?.created_at || input?.timestamp || "",
    payload: canonicalize(input?.payload ?? {}),
  };
  return JSON.stringify(canonicalize(fields));
};
