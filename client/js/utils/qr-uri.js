/*
Encodes and decodes simple URI strings for QR code payloads.

Format:
  iou://friend?key=npub1...
  iou://pay?key=npub1...&amount=50&note=lunch
*/

export const encodeAddFriendUri = (npub) => {
  return `iou://friend?key=${encodeURIComponent(npub)}`;
};

export const encodePayUri = (npub, amount, note) => {
  const params = new URLSearchParams({ key: npub });
  if (amount) {
    params.set("amount", String(amount));
  }
  if (note) {
    params.set("note", note);
  }
  return `iou://pay?${params}`;
};

export const parseIouUri = (text) => {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed.startsWith("iou://")) {
    return null;
  }

  try {
    // Replace iou:// with https:// so URL parser works
    const url = new URL(trimmed.replace("iou://", "https://"));
    const type = url.hostname;
    if (type !== "friend" && type !== "pay") {
      return null;
    }

    const key = url.searchParams.get("key") || "";
    if (!key) {
      return null;
    }

    const result = { type, key };
    if (type === "pay") {
      const amount = url.searchParams.get("amount");
      if (amount) {
        result.amount = parseFloat(amount);
      }
      const note = url.searchParams.get("note");
      if (note) {
        result.note = note;
      }
    }

    return result;
  } catch {
    return null;
  }
};
