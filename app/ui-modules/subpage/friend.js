/*
This module binds the friend detail subpage. It renders debt/trust summary cards, injects friend-specific labels, and lists recent transactions.

It also exposes navigation triggers to related subpages by wiring the trust tile click target from the current friend context.
*/

import {
  acceptFriend,
  rejectFriend,
  removeFriendRequest,
} from "../../js/commands/friendship.js";
import {
  cancelTrustLimitSuggestion,
  dismissTrustLimitNotification,
  respondToTrustLimitSuggestion,
} from "../../js/commands/trust-limit.js";
import {
  dismissPaymentRequest,
  respondToPaymentRequest,
} from "../../js/commands/payment-request.js";
import { dismissNameChangeNotification } from "../../js/commands/user.js";
import {
  FRIENDSHIP_STATUS_ACCEPTED,
  FRIENDSHIP_STATUS_PENDING_INCOMING,
  FRIENDSHIP_STATUS_PENDING_OUTGOING,
  FRIENDSHIP_STATUS_REJECTED,
  isAcceptedFriendshipStatus,
} from "../../js/utils/friendships.js";
import { formatCurrency, formatDate, formatSigned } from "../../js/ui/format.js";
import { createFriendIcon, setFriendIconStatus } from "../components/friend-icon.js";
import { initInfiniteList } from "../../js/ui/infinite-list.js";
import { getConnectedPeerIds, getServerPresentPeerIds } from "../../js/peer/status.js";
import { showConfirmModal } from "../components/confirm-modal.js";

export const bindFriendDetail = (root, data, friendId) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const labelEl = root.querySelector('[data-bind="friend-label"]');
  const headerRight = root.querySelector('[data-slot="subpage-header-right"]');
  const bodyEl = root.querySelector('[data-section="friend-body"]');
  const debtLabelEl = root.querySelector('[data-bind="debt-label"]');
  const debtAmountEl = root.querySelector('[data-bind="debt-amount"]');
  const trustTitleEl = root.querySelector('[data-bind="trust-title"]');
  const trustAmountEl = root.querySelector('[data-bind="trust-amount"]');
  const trustButton = root.querySelector('[data-section="trust-limit"]');
  const listEl = root.querySelector('[data-list="friend-transactions"]');
  const txTemplate = root.querySelector('[data-template="tx-item"]');
  const friendRequestEl = root.querySelector('[data-section="friend-request-notification"]');
  const friendRequestLabelEl = root.querySelector('[data-bind="friend-request-label"]');
  const friendAcceptActionsEl = root.querySelector('[data-section="friend-accept-actions"]');
  const friendRemoveActionsEl = root.querySelector('[data-section="friend-remove-actions"]');
  const suggestionEl = root.querySelector('[data-section="trust-suggestion"]');
  const suggestionLabelEl = root.querySelector('[data-bind="trust-suggestion-label"]');
  const suggestionActionsEl = root.querySelector('[data-section="trust-suggestion-actions"]');
  const suggestionCancelActionsEl = root.querySelector('[data-section="trust-cancel-actions"]');
  const suggestionOkActionsEl = root.querySelector('[data-section="trust-ok-actions"]');
  const suggestionExplainerEl = root.querySelector('[data-section="trust-suggestion-explainer"]');
  const paymentRequestEl = root.querySelector('[data-section="payment-request"]');
  const paymentRequestLabelEl = root.querySelector('[data-bind="payment-request-label"]');
  const paymentRequestAcceptActionsEl = root.querySelector('[data-section="payment-request-accept-actions"]');
  const paymentRequestCancelActionsEl = root.querySelector('[data-section="payment-request-cancel-actions"]');

  const syncInfoEl = root.querySelector('[data-section="sync-info"]');
  const syncTimeEl = root.querySelector('[data-bind="sync-time"]');
  const friendKeyLabelEl = root.querySelector('[data-bind="friend-key-label"]');
  const friendDangerButton = root.querySelector('[data-action="friend-danger-action"]');
  const friendDangerLabelEl = root.querySelector('[data-bind="friend-danger-label"]');

  const friend = data.friends.find((entry) => entry.person_id === friendId);
  const friendName = friend?.person_name || "Friend";
  const friendFirstName = friendName.split(/\s+/)[0] || friendName;
  const friendshipStatus = friend?.friendship_status || FRIENDSHIP_STATUS_ACCEPTED;
  const debt = friend?.debt_eur || 0;
  const isOnline = getConnectedPeerIds().includes(friendId);
  const isRelay = !isOnline && getServerPresentPeerIds().includes(friendId);
  const friendDangerActionLabel =
    debt > 0 ? "Absolve debt" : debt < 0 ? "Default on debt" : "Deactivate friend connection";
  const friendDangerBody =
    debt > 0
      ? `Cancel ${friendName}'s debt of **€${Math.abs(debt).toFixed(2)}** to you. With this action, you also **deactivate** your friend connection, stopping any activity between you two.\n\nIf you want to forgive the debt without deactivating the connection, you can do this by sending them an IOU of €${Math.abs(debt).toFixed(2)}.\n\nIt is still possible to reactivate the friend connection and this debt later, if both of you agree to do so.`
      : debt < 0
      ? `Defaulting on debt can have **serious consequences**. It is strongly recommended to talk about this with ${friendName} before taking this step. You currently owe **${Math.abs(debt).toFixed(2)} €** to ${friendName}.\n\nIn practice this action stops any activity with ${friendName} and removes this from the tally. If both of you agree, the friend connection and this debt can be reactivated later.`
      : `With this action, you deactivate your friend connection to ${friendName}, stopping any activity between you two. The transaction history will remain visible on this page.\n\nThe friend connection can be reactivated later if both of you agree to do so.`;

  if (titleEl) {
    titleEl.textContent = friendName;
    if (isOnline || isRelay) {
      const icon = createFriendIcon();
      setFriendIconStatus(icon, isOnline, isRelay);
      titleEl.append(icon);
    }
  }

  if (friendKeyLabelEl) friendKeyLabelEl.textContent = `${friendFirstName}'s key`;
  if (friendDangerLabelEl) friendDangerLabelEl.textContent = friendDangerActionLabel;
  if (friendDangerButton) {
    friendDangerButton.addEventListener("click", async () => {
      await showConfirmModal({
        title: friendDangerActionLabel,
        body: friendDangerBody,
        confirmLabel: friendDangerActionLabel,
        confirmButtonLabel: friendDangerActionLabel,
      });
    });
  }

  if (syncInfoEl && syncTimeEl) {
    if (friend?.last_synced_at) {
      const syncDate = new Date(friend.last_synced_at);
      if (!Number.isNaN(syncDate.getTime())) {
        const now = new Date();
        const diffMs = now - syncDate;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));

        let timeAgo;
        if (diffDays > 0) {
          timeAgo = `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
        } else if (diffHours > 0) {
          timeAgo = `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
        } else {
          timeAgo = `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
        }

        syncTimeEl.textContent = timeAgo;
        syncInfoEl.hidden = false;
      }
    } else {
      syncTimeEl.textContent = "Never";
      syncInfoEl.hidden = false;
    }
  }
  if (labelEl) {
    labelEl.textContent = isAcceptedFriendshipStatus(friendshipStatus)
      ? `My transactions with ${friendFirstName}`
      : `Friendship with ${friendFirstName}`;
  }
  if (headerRight) {
    if (friendshipStatus === FRIENDSHIP_STATUS_ACCEPTED) {
      headerRight.innerHTML = `
        <button class="friend-send surface-box" type="button" data-action="send" aria-label="Record tally">
          <svg class="friend-send-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <use href="#icon-send" />
          </svg>
          <span class="friend-send-label">Record</span>
        </button>
      `;
    } else if (friendshipStatus === FRIENDSHIP_STATUS_REJECTED) {
      headerRight.innerHTML = `
        <span class="friend-status-chip surface-box">Rejected</span>
      `;
    }
  }
  if (friendRequestEl) {
    if (friendshipStatus === FRIENDSHIP_STATUS_PENDING_INCOMING) {
      friendRequestEl.hidden = false;
      if (friendRequestLabelEl) friendRequestLabelEl.textContent = `${friendFirstName} wants to be friends`;
      if (friendAcceptActionsEl) friendAcceptActionsEl.hidden = false;
    } else if (friendshipStatus === FRIENDSHIP_STATUS_PENDING_OUTGOING) {
      friendRequestEl.hidden = false;
      if (friendRequestLabelEl) friendRequestLabelEl.textContent = `Friend request sent to ${friendFirstName}`;
      if (friendRemoveActionsEl) friendRemoveActionsEl.hidden = false;
    }
  }
  if (trustTitleEl) {
    trustTitleEl.textContent =
      friendshipStatus === FRIENDSHIP_STATUS_PENDING_OUTGOING ||
      friendshipStatus === FRIENDSHIP_STATUS_PENDING_INCOMING
        ? "Suggested trust limit"
        : "Trust limit";
  }
  if (trustAmountEl) {
    const trustLimit = friend?.trust_credit_limit_eur ?? 0;
    trustAmountEl.textContent = formatCurrency(trustLimit);
  }
  if (
    trustButton &&
    friendId &&
    (friendshipStatus === FRIENDSHIP_STATUS_ACCEPTED ||
      friendshipStatus === FRIENDSHIP_STATUS_PENDING_OUTGOING)
  ) {
    trustButton.addEventListener("click", () => {
      window.location.hash = `trust/${friendId}`;
    });
  } else if (trustButton) {
    trustButton.classList.add("friend-stat--disabled");
    trustButton.setAttribute("aria-disabled", "true");
  }
  if (debtLabelEl) {
    if (isAcceptedFriendshipStatus(friendshipStatus)) {
      debtLabelEl.textContent = debt >= 0 ? "owes you" : "you owe";
    } else {
      debtLabelEl.textContent = "Friendship";
    }
  }
  if (debtAmountEl) {
    if (isAcceptedFriendshipStatus(friendshipStatus)) {
      debtAmountEl.textContent = formatSigned(debt);
      debtAmountEl.classList.toggle("pos", debt >= 0);
      debtAmountEl.classList.toggle("neg", debt < 0);
    } else {
      const statusText =
        friendshipStatus === FRIENDSHIP_STATUS_PENDING_INCOMING
          ? "Incoming"
          : friendshipStatus === FRIENDSHIP_STATUS_REJECTED
          ? "Rejected"
          : "Pending";
      debtAmountEl.textContent = statusText;
      debtAmountEl.classList.remove("pos", "neg");
    }
  }

  const acceptButton = root.querySelector('[data-action="accept-friend"]');
  if (acceptButton && friendId) {
    acceptButton.addEventListener("click", async () => {
      await acceptFriend(friendId);
    });
  }
  const rejectButton = root.querySelector('[data-action="reject-friend"]');
  if (rejectButton && friendId) {
    rejectButton.addEventListener("click", async () => {
      await rejectFriend(friendId);
      window.location.hash = "friends";
    });
  }
  const removeRequestButton = root.querySelector('[data-action="remove-request"]');
  if (removeRequestButton && friendId) {
    removeRequestButton.addEventListener("click", async () => {
      await removeFriendRequest(friendId);
      window.location.hash = "friends";
    });
  }

  const pendingLimit = friend?.pending_credit_limit_eur;
  const isIncoming = friend?.pending_credit_limit_is_incoming;
  const hasPendingSuggestion = Number.isFinite(pendingLimit) && pendingLimit >= 0;

  if (suggestionEl && hasPendingSuggestion) {
    suggestionEl.hidden = false;
    if (isIncoming === "lowered") {
      const amountText = `${friendFirstName} lowered trust limit to ${formatCurrency(pendingLimit)}`;
      if (suggestionLabelEl) suggestionLabelEl.textContent = amountText;
      if (suggestionOkActionsEl) suggestionOkActionsEl.hidden = false;
    } else {
      if (suggestionExplainerEl) suggestionExplainerEl.hidden = false;
      const amountText = `Suggested trust limit* of ${formatCurrency(pendingLimit)}`;
      if (suggestionLabelEl) suggestionLabelEl.textContent = amountText;
      if (isIncoming === true && suggestionActionsEl) suggestionActionsEl.hidden = false;
      if (isIncoming === false && suggestionCancelActionsEl) suggestionCancelActionsEl.hidden = false;
    }
  }

  const agreeTrustButton = root.querySelector('[data-action="agree-trust"]');
  if (agreeTrustButton && friendId) {
    agreeTrustButton.addEventListener("click", async () => {
      if (suggestionEl) suggestionEl.hidden = true;
      if (suggestionExplainerEl) suggestionExplainerEl.hidden = true;
      await respondToTrustLimitSuggestion(friendId, true);
    });
  }
  const disagreeTrustButton = root.querySelector('[data-action="disagree-trust"]');
  if (disagreeTrustButton && friendId) {
    disagreeTrustButton.addEventListener("click", async () => {
      if (suggestionEl) suggestionEl.hidden = true;
      if (suggestionExplainerEl) suggestionExplainerEl.hidden = true;
      await respondToTrustLimitSuggestion(friendId, false);
    });
  }
  const cancelTrustButton = root.querySelector('[data-action="cancel-trust"]');
  if (cancelTrustButton && friendId) {
    cancelTrustButton.addEventListener("click", async () => {
      if (suggestionEl) suggestionEl.hidden = true;
      if (suggestionExplainerEl) suggestionExplainerEl.hidden = true;
      await cancelTrustLimitSuggestion(friendId);
    });
  }

  const dismissTrustButton = root.querySelector('[data-action="dismiss-trust"]');
  if (dismissTrustButton && friendId) {
    dismissTrustButton.addEventListener("click", async () => {
      if (suggestionEl) suggestionEl.hidden = true;
      await dismissTrustLimitNotification(friendId);
    });
  }

  const nameChangeEl = root.querySelector('[data-section="name-change-notification"]');
  const nameChangeLabelEl = root.querySelector('[data-bind="name-change-label"]');
  const pendingNameChange = friend?.pending_name_change;
  if (nameChangeEl && pendingNameChange) {
    nameChangeEl.hidden = false;
    if (nameChangeLabelEl) {
      nameChangeLabelEl.textContent = `${pendingNameChange.oldName} changed their name to ${pendingNameChange.newName}`;
    }
  }

  const dismissNameChangeButton = root.querySelector('[data-action="dismiss-name-change"]');
  if (dismissNameChangeButton && friendId) {
    dismissNameChangeButton.addEventListener("click", async () => {
      if (nameChangeEl) nameChangeEl.hidden = true;
      await dismissNameChangeNotification(friendId);
    });
  }

  const pendingPaymentRequest = friend?.pending_payment_request;
  if (paymentRequestEl && pendingPaymentRequest) {
    paymentRequestEl.hidden = false;
    const amount = pendingPaymentRequest.amount_eur;
    const note = pendingPaymentRequest.note;
    if (pendingPaymentRequest.is_incoming) {
      const labelText = note
        ? `${friendFirstName} requests €${amount.toFixed(2)} — ${note}`
        : `${friendFirstName} requests €${amount.toFixed(2)}`;
      if (paymentRequestLabelEl) paymentRequestLabelEl.textContent = labelText;
      if (paymentRequestAcceptActionsEl) paymentRequestAcceptActionsEl.hidden = false;
    } else {
      const labelText = note
        ? `You requested €${amount.toFixed(2)} from ${friendFirstName} — ${note}`
        : `You requested €${amount.toFixed(2)} from ${friendFirstName}`;
      if (paymentRequestLabelEl) paymentRequestLabelEl.textContent = labelText;
      if (paymentRequestCancelActionsEl) paymentRequestCancelActionsEl.hidden = false;
    }
  }

  const acceptPaymentButton = root.querySelector('[data-action="accept-payment-request"]');
  if (acceptPaymentButton && friendId) {
    acceptPaymentButton.addEventListener("click", async () => {
      if (paymentRequestEl) paymentRequestEl.hidden = true;
      await respondToPaymentRequest(friendId, true);
    });
  }
  const declinePaymentButton = root.querySelector('[data-action="decline-payment-request"]');
  if (declinePaymentButton && friendId) {
    declinePaymentButton.addEventListener("click", async () => {
      if (paymentRequestEl) paymentRequestEl.hidden = true;
      await respondToPaymentRequest(friendId, false);
    });
  }
  const cancelPaymentButton = root.querySelector('[data-action="cancel-payment-request"]');
  if (cancelPaymentButton && friendId) {
    cancelPaymentButton.addEventListener("click", async () => {
      if (paymentRequestEl) paymentRequestEl.hidden = true;
      await dismissPaymentRequest(friendId);
    });
  }

  const friendKeyEl = root.querySelector('[data-bind="friend-public-key"]');
  if (friendKeyEl) friendKeyEl.textContent = friendId;

  if (!bodyEl || !listEl || !txTemplate) return;
  listEl.innerHTML = "";

  if (!isAcceptedFriendshipStatus(friendshipStatus)) {
    const statusBodyText =
      friendshipStatus === FRIENDSHIP_STATUS_PENDING_INCOMING
        ? "This friend request is waiting for your decision."
        : friendshipStatus === FRIENDSHIP_STATUS_REJECTED
        ? "This friendship request has been rejected."
        : "This friend request is pending until the other user accepts it.";
    bodyEl.innerHTML = `<div class="empty">${statusBodyText}</div>`;
    return;
  }

  const transactions = Array.isArray(friend?.recent_transactions)
    ? friend.recent_transactions
    : [];
  const lastViewedTransactionIds = new Set(
    Array.isArray(friend?.last_viewed_transaction_ids)
      ? friend.last_viewed_transaction_ids
      : []
  );

  if (!transactions.length) {
    bodyEl.innerHTML = `<div class="empty">No transactions yet.</div>`;
    return;
  }

  initInfiniteList(listEl, transactions, (tx) => {
    const txNode = txTemplate.content.firstElementChild.cloneNode(true);
    const dateEl = txNode.querySelector('[data-bind="date"]');
    const amountTxEl = txNode.querySelector('[data-bind="amount"]');
    const noteEl = txNode.querySelector('[data-bind="note"]');
    const isNewTransaction = tx?.id && !lastViewedTransactionIds.has(tx.id);

    txNode.classList.toggle("tx-item--new", Boolean(isNewTransaction));
    if (dateEl) dateEl.textContent = formatDate(tx.date);
    if (amountTxEl) amountTxEl.textContent = formatSigned(tx.amount_eur);
    if (noteEl) noteEl.textContent = tx.note;
    return txNode;
  });
};
