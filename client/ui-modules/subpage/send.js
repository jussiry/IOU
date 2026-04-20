/*
This module binds the send-IOU subpage form. It populates selectable friends, updates explanatory copy, and returns a payload reader for submit handling.

Only accepted friendships can be used for transactions, so the binder also owns the empty states shown when the user has no friends yet or only pending friendships.
*/

import { isAcceptedFriendshipStatus } from "../../js/utils/friendships.js";
import { loadVendorScript } from "../../js/utils/vendor-loader.js";
import { parseIouUri } from "../../js/utils/qr-uri.js";

const renderEmptyState = (contentEl, allConnections) => {
  if (!contentEl) {
    return;
  }

  const hasAnyConnections = Array.isArray(allConnections) && allConnections.length > 0;
  contentEl.innerHTML = hasAnyConnections
    ? `
      <div class="send-empty-state empty">
        No accepted friends yet. Complete a pending friendship or <a class="send-empty-link" href="#add-friend">add a new friend</a>
        before making a transaction.
      </div>
    `
    : `
      <div class="send-empty-state empty">
        No friends exist. <a class="send-empty-link" href="#add-friend">Add a new friend</a> to
        make your first transaction.
      </div>
    `;
};

export const bindSend = (root, data, friendId) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const contentEl = root.querySelector(".send-content");
  const selectEl = root.querySelector('[data-bind="send-to"]');
  const explainerEl = root.querySelector('[data-bind="send-explainer"]');
  const amountEl = root.querySelector('[data-bind="send-amount"]');
  const messageEl = root.querySelector('[data-bind="send-message"]');
  const submitEl = root.querySelector('[data-bind="send-submit"]');

  if (titleEl) titleEl.textContent = "Send IOU";

  if (messageEl) {
    const autoGrow = () => {
      messageEl.style.height = "auto";
      messageEl.style.height = messageEl.scrollHeight + "px";
    };
    messageEl.addEventListener("input", autoGrow);
  }

  const allConnections = Array.isArray(data?.connections) ? data.connections : [];
  const acceptedConnections = allConnections
    .filter((connection) => isAcceptedFriendshipStatus(connection.friendship_status))
    .sort((leftConnection, rightConnection) => {
      const leftName = leftConnection.person_name || leftConnection.person_id || "";
      const rightName = rightConnection.person_name || rightConnection.person_id || "";
      return leftName.localeCompare(rightName);
    });
  if (!acceptedConnections.length) {
    renderEmptyState(contentEl, allConnections);
    return {
      submitEl: null,
      getPayload: () => ({
        friendId: "",
        amount: NaN,
        message: "",
      }),
    };
  }

  const getFirstName = (fullName) => fullName.split(/\s+/)[0] || fullName;

  const updateExplainer = (name, alternate) => {
    if (!explainerEl) return;
    const friendName = name ? getFirstName(name) : "your friend";
    const otherName = alternate ? getFirstName(alternate) : "another friend";
    explainerEl.innerHTML = `
      <p>When sending IOU's (I Owe You) you are <strong>making a promise</strong> of giving something of that value back some time later.</p>
      <p>This transaction can be redeemed by your friend sending their IOU's back to you. IOU's can also be redeemed in circular cancellation: <strong>you</strong> owe <strong>${friendName}</strong> who owes <strong>${otherName}</strong> who owes <strong>you</strong>. Circular cancellations are made automatically by the system.</p>
    `;
  };

  if (selectEl) {
    selectEl.innerHTML = "";
    acceptedConnections.forEach((connection) => {
      const option = document.createElement("option");
      option.value = connection.person_id;
      option.textContent = connection.person_name || connection.person_id;
      selectEl.appendChild(option);
    });

    const initialSelection =
      acceptedConnections.find((connection) => connection.person_id === friendId) ||
      acceptedConnections[0] ||
      null;
    if (initialSelection) {
      selectEl.value = initialSelection.person_id;
    }

    const selectAlternate = (currentId) => {
      const candidates = acceptedConnections.filter(
        (connection) => connection.person_id !== currentId
      );
      if (!candidates.length) return null;
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return pick?.person_name || pick?.person_id || null;
    };

    const selected = acceptedConnections.find(
      (connection) => connection.person_id === selectEl.value
    );
    const selectedName = selected?.person_name || selected?.person_id;
    updateExplainer(selectedName, selectAlternate(selectEl.value));

    selectEl.addEventListener("change", () => {
      const current = acceptedConnections.find(
        (connection) => connection.person_id === selectEl.value
      );
      const name = current?.person_name || current?.person_id;
      updateExplainer(name, selectAlternate(selectEl.value));
    });
  } else {
    updateExplainer(null, null);
  }

  // --- QR code scanning ---
  const headerRightEl = root.querySelector('[data-slot="subpage-header-right"]');
  if (headerRightEl) {
    headerRightEl.innerHTML = `
      <button class="send-scan-button" type="button" data-action="scan-send-qr" aria-label="Scan QR code">
        <svg class="send-scan-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <use href="#icon-qr-scan" />
        </svg>
      </button>
    `;
  }
  const scanQrButtonEl = root.querySelector('[data-action="scan-send-qr"]');
  const scannerSectionEl = root.querySelector('[data-section="send-qr-scanner"]');
  const qrReaderEl = root.querySelector('[data-bind="send-qr-reader"]');
  const closeScannerButtonEl = root.querySelector('[data-action="close-send-scanner"]');
  let html5Qrcode = null;

  const stopScanner = async () => {
    if (html5Qrcode) {
      try { await html5Qrcode.stop(); } catch { /* already stopped */ }
      html5Qrcode.clear();
      html5Qrcode = null;
    }
    if (scannerSectionEl) scannerSectionEl.hidden = true;
  };

  const onScanSuccess = (decodedText) => {
    const parsed = parseIouUri(decodedText);
    if (!parsed || !parsed.key) {
      return;
    }

    // Check if the scanned key is an accepted friend
    const matchedFriend = acceptedConnections.find(
      (c) => c.person_id === parsed.key
    );

    if (matchedFriend) {
      // Fill form fields
      if (selectEl) selectEl.value = matchedFriend.person_id;
      if (parsed.amount && amountEl) amountEl.value = parsed.amount;
      if (parsed.note && messageEl) {
        messageEl.value = parsed.note;
        messageEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (selectEl) selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // Not a friend — prompt to add them
      const shouldAdd = window.confirm(
        "This person is not your friend yet. Would you like to add them?"
      );
      if (shouldAdd) {
        void stopScanner();
        window.location.hash = `add-friend`;
        // Pre-fill the friend key after navigation
        window.__prefillFriendKey = parsed.key;
        return;
      }
    }

    void stopScanner();
  };

  scanQrButtonEl?.addEventListener("click", async () => {
    try {
      const lib = await loadVendorScript(
        "dist/js/vendor/html5-qrcode.min.js",
        "__Html5QrcodeLibrary__"
      );
      const Html5Qrcode = lib.Html5Qrcode;
      if (scannerSectionEl) scannerSectionEl.hidden = false;

      const readerId = `send-qr-reader-${Date.now()}`;
      qrReaderEl.id = readerId;

      html5Qrcode = new Html5Qrcode(readerId);
      await html5Qrcode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        onScanSuccess,
      );
    } catch (error) {
      console.warn("[QR] Scanner failed to start", error);
      void stopScanner();
    }
  });

  closeScannerButtonEl?.addEventListener("click", () => {
    void stopScanner();
  });

  // Clean up scanner on page removal
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      void stopScanner();
      observer.disconnect();
    }
  });
  observer.observe(root.parentElement || document.body, { childList: true, subtree: true });

  return {
    submitEl,
    getPayload: () => {
      const selectedId = selectEl?.value || acceptedConnections[0]?.person_id || "";
      const amount = amountEl ? parseFloat(amountEl.value) : NaN;
      const message = messageEl ? messageEl.value : "";
      return {
        friendId: selectedId,
        amount,
        message,
      };
    },
  };
};
