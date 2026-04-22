/*
Binds the logs page by deriving human-readable rows from the ledger.

Each ledger entry is a peer message that either the user sent or received;
the formatter below turns it into a presentation string based on its type.
Formatting lives here (not in the data layer) so the ledger stays transport-
focused while this module owns display concerns.
*/

import { formatMarkdownish } from "../../js/utils/markdownish.js";
import {
  getConnectedPeerIds,
  getConnectedSelfDeviceIds,
} from "../../js/peer/status.js";
import { initInfiniteList } from "../../js/ui/infinite-list.js";

const formatEur = (amount) => {
  const value = Number(amount);
  return Number.isFinite(value) ? `€${value.toFixed(2)}` : "€0.00";
};

const getPeerDisplayName = (namesById, peerId, fallback = "") =>
  namesById[peerId] || fallback || peerId;

const formatLedgerEntry = (entry, myId, namesById) => {
  const isOutgoing = entry.from_user_id === myId;
  const peerId = isOutgoing ? entry.to_user_id : entry.from_user_id;
  const peerName = getPeerDisplayName(namesById, peerId);
  const peerBold = `**${peerName}**`;
  const payload = entry.payload || {};

  switch (entry.type) {
    case "friend_request":
      return isOutgoing
        ? `Friend request sent to ${peerBold}`
        : `Friend request received from ${peerBold}`;
    case "friend_accept":
      return isOutgoing
        ? `You accepted ${peerBold} as a friend`
        : `${peerBold} accepted your friend request`;
    case "friend_reject":
      return isOutgoing
        ? `You rejected friend request from ${peerBold}`
        : `${peerBold} rejected your friend request`;
    case "credit_limit_suggestion": {
      const limit = formatEur(payload.credit_limit_eur);
      return isOutgoing
        ? `You suggested trust limit of ${limit} with ${peerBold}`
        : `${peerBold} suggested trust limit of ${limit}`;
    }
    case "transaction_created": {
      const amount = formatEur(payload.amount_eur);
      return isOutgoing
        ? `You sent ${amount} to ${peerBold}`
        : `${peerBold} sent ${amount} to you`;
    }
    case "payment_request": {
      const amount = formatEur(payload.amount_eur);
      return isOutgoing
        ? `You requested ${amount} from ${peerBold}`
        : `${peerBold} requested ${amount} from you`;
    }
    case "payment_request_response": {
      const accepted = payload.accepted === true;
      if (isOutgoing) {
        return accepted
          ? `You accepted payment request from ${peerBold}`
          : `You declined payment request from ${peerBold}`;
      }
      return accepted
        ? `${peerBold} accepted your payment request`
        : `${peerBold} declined your payment request`;
    }
    case "name_changed": {
      const newName = typeof payload.name === "string" ? payload.name : "";
      return isOutgoing
        ? `You changed your name to **${newName}**`
        : `${peerBold} changed name to **${newName}**`;
    }
    default:
      return `${entry.type} ${isOutgoing ? "→" : "←"} ${peerBold}`;
  }
};

export const bindLogs = (root, data) => {
  const peerConnectionsEl = root.querySelector('[data-bind="peer-connections"]');
  const selfDeviceConnectionsEl = root.querySelector(
    '[data-bind="self-device-connections"]'
  );
  const listEl = root.querySelector('[data-list="logs"]');
  const itemTemplate = root.querySelector('[data-template="log-item"]');
  if (!listEl || !itemTemplate) return;

  if (peerConnectionsEl) {
    peerConnectionsEl.textContent = String(getConnectedPeerIds().length);
  }
  if (selfDeviceConnectionsEl) {
    selfDeviceConnectionsEl.textContent = String(
      getConnectedSelfDeviceIds().length
    );
  }

  listEl.innerHTML = "";

  const myId = data.you?.id || "";
  const namesById = {};
  (Array.isArray(data.friends) ? data.friends : []).forEach((friend) => {
    if (friend.person_id) {
      namesById[friend.person_id] = friend.person_name || friend.person_id;
    }
  });

  const entries = Array.isArray(data.ledger) ? data.ledger : [];

  initInfiniteList(listEl, entries, (entry) => {
    const node = itemTemplate.content.firstElementChild.cloneNode(true);
    const timeEl = node.querySelector('[data-bind="time"]');
    const textEl = node.querySelector('[data-bind="text"]');
    if (timeEl) {
      const time = new Date(entry.timestamp);
      timeEl.textContent = Number.isNaN(time.getTime())
        ? ""
        : time.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
    }
    if (textEl) {
      textEl.innerHTML = formatMarkdownish(
        formatLedgerEntry(entry, myId, namesById)
      );
    }
    node.addEventListener("click", () => {
      node.classList.toggle("log-item--expanded");
    });
    return node;
  });
};
