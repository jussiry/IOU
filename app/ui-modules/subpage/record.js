/*
This module binds the record-tally subpage form. It populates selectable friends, updates explanatory copy, and returns a payload reader for submit handling.

Only accepted friendships can be used for transactions, so the binder also owns the empty states shown when the user has no friends yet or only pending friendships.

The submit button label updates dynamically to "Send €[amount]" as the user types an amount, making clear that recording a tally is equivalent in effect to sending that value.
*/

import { isAcceptedFriendshipStatus } from "../../js/utils/friendships.js";
import { loadVendorScript } from "../../js/utils/vendor-loader.js";
import { parseIouUri } from "../../js/utils/qr-uri.js";
import { bindOwesPreview } from "../components/owes-sentence.js";
import { randomNotePlaceholder } from "../../js/utils/note-placeholders.js";


const renderEmptyState = (contentEl, allFriends) => {
  if (!contentEl) {
    return;
  }

  const hasAnyFriends = Array.isArray(allFriends) && allFriends.length > 0;
  contentEl.innerHTML = hasAnyFriends
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

export const bindRecord = (root, data, friendId) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const contentEl = root.querySelector(".send-content");
  const selectEl = root.querySelector('[data-bind="send-to"]');
  const explainerEl = root.querySelector('[data-bind="send-explainer"]');
  const amountEl = root.querySelector('[data-bind="send-amount"]');
  const messageEl = root.querySelector('[data-bind="send-message"]');
  const submitEl = root.querySelector('[data-bind="send-submit"]');
  const submitLabelEl = submitEl?.querySelector(".primary-button-label");
  const previewUserAmountEl = root.querySelector('[data-bind="record-preview-user-amount"]');

  const previewUserNameEl = root.querySelector('[data-bind="record-preview-user-name"]');
  const previewFriendAmountEl = root.querySelector('[data-bind="record-preview-friend-amount"]');

  if (titleEl) titleEl.textContent = "Send a signed record";
  if (messageEl) messageEl.placeholder = randomNotePlaceholder();

  // Tally diff preview — the user (debtor) goes negative, the friend (creditor)
  // goes positive by the same amount. The shared bindOwesPreview helper keeps
  // the preview row in sync with the amount input.
  let currentFriendName = "your friend";
  const userName = data?.you?.name || "You";
  if (previewUserNameEl) previewUserNameEl.textContent = userName;

  const updatePreview = bindOwesPreview({
    amountEl,
    debtorAmountEl: previewUserAmountEl,
    creditorAmountEl: previewFriendAmountEl,
  });

  if (messageEl) {
    const autoGrow = () => {
      messageEl.style.height = "auto";
      messageEl.style.height = messageEl.scrollHeight + "px";
    };
    messageEl.addEventListener("input", autoGrow);
  }

  const allFriends = Array.isArray(data?.friends) ? data.friends : [];
  const acceptedFriends = allFriends
    .filter((friend) => isAcceptedFriendshipStatus(friend.friendship_status))
    .sort((leftFriend, rightFriend) => {
      const leftName = leftFriend.person_name || leftFriend.person_id || "";
      const rightName = rightFriend.person_name || rightFriend.person_id || "";
      return leftName.localeCompare(rightName);
    });
  if (!acceptedFriends.length) {
    renderEmptyState(contentEl, allFriends);
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

  const updateSubmitLabel = (name) => {
    if (submitLabelEl)
      submitLabelEl.textContent = `Sign and send to ${name ? getFirstName(name) : "friend"}`;
  };

  const updateExplainer = (name) => {
    if (!explainerEl) return;
    const friendName = name ? getFirstName(name) : "your friend";
    explainerEl.innerHTML = `
      <p>In Tally, <strong>instead of sending actual euros you sign a record saying you owe euros</strong>. Later ${friendName} can use the value of this record to buy things from you — or from someone else through you, by using chained records.</p>
      <p>The signed record is stored on your and ${friendName}'s devices, and only visible to you two.</p>
    `;
  };

  if (selectEl) {
    selectEl.innerHTML = "";
    acceptedFriends.forEach((friend) => {
      const option = document.createElement("option");
      option.value = friend.person_id;
      option.textContent = friend.person_name || friend.person_id;
      selectEl.appendChild(option);
    });

    const initialSelection =
      acceptedFriends.find((friend) => friend.person_id === friendId) ||
      acceptedFriends[0] ||
      null;
    if (initialSelection) {
      selectEl.value = initialSelection.person_id;
    }


    const selected = acceptedFriends.find(
      (friend) => friend.person_id === selectEl.value
    );
    const selectedName = selected?.person_name || selected?.person_id;
    currentFriendName = selectedName || "your friend";
    updateExplainer(selectedName);
    updateSubmitLabel(selectedName);
    updatePreview();

    selectEl.addEventListener("change", () => {
      const current = acceptedFriends.find(
        (friend) => friend.person_id === selectEl.value
      );
      const name = current?.person_name || current?.person_id;
      currentFriendName = name || "your friend";
      updateExplainer(name);
      updateSubmitLabel(name);
      updatePreview();
    });
  } else {
    updateExplainer(null);
    updateSubmitLabel(null);
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
    const matchedFriend = acceptedFriends.find(
      (friend) => friend.person_id === parsed.key
    );

    if (matchedFriend) {
      // Fill form fields
      if (selectEl) selectEl.value = matchedFriend.person_id;
      if (parsed.amount && amountEl) {
        amountEl.value = parsed.amount;
        amountEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
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
      const selectedId = selectEl?.value || acceptedFriends[0]?.person_id || "";
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
