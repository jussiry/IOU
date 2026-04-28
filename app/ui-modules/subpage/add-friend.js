/*
This module binds the add-friend subpage. It manages the public-key form, the self-key copy field, the trust-limit toggle, and the dynamic visibility of the optional trust-limit input.

It keeps the add-friend form state local to the page, validates the entered public key, and handles lightweight clipboard/select interactions so routing code can handle persistence and navigation without duplicating DOM queries.
*/

import { initCheckToggle } from "../components/check-toggle.js";
import { isValidNpub } from "../../js/utils/nostr-keys.js";
import { loadVendorScript } from "../../js/utils/vendor-loader.js";
import { encodeAddFriendUri, parseIouUri } from "../../js/utils/qr-uri.js";

const selectInputText = (inputEl) => {
  if (!inputEl) {
    return;
  }

  inputEl.focus();
  inputEl.select();
  if (typeof inputEl.setSelectionRange === "function") {
    inputEl.setSelectionRange(0, inputEl.value.length);
  }
};

const copyTextToClipboard = async (text, inputEl) => {
  const normalizedText = typeof text === "string" ? text : "";
  if (!normalizedText) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(normalizedText);
      return true;
    }
  } catch {
    // fall through to selection-based copy
  }

  selectInputText(inputEl);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
};

export const bindAddFriend = (root, data) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const myKeyEl = root.querySelector('[data-bind="my-key"]');
  const copyMyKeyButtonEl = root.querySelector('[data-action="copy-my-key"]');
  const myKeyQrEl = root.querySelector('[data-bind="my-key-qr"]');
  const friendKeyEl = root.querySelector('[data-bind="friend-key"]');
  const friendKeyErrorEl = root.querySelector('[data-bind="friend-key-error"]');
  const scanQrButtonEl = root.querySelector('[data-action="scan-qr"]');
  const scannerSectionEl = root.querySelector('[data-section="qr-scanner"]');
  const qrReaderEl = root.querySelector('[data-bind="qr-reader"]');
  const closeScannerButtonEl = root.querySelector('[data-action="close-scanner"]');
  const toggleEl = root.querySelector('[data-bind="suggest-trust-toggle"]');
  const trustPanelEl = root.querySelector('[data-section="suggest-trust-panel"]');
  const trustExplainerEl = root.querySelector('[data-section="suggest-trust-explainer"]');
  const trustLimitEl = root.querySelector('[data-bind="trust-limit"]');
  const submitEl = root.querySelector('[data-bind="add-friend-submit"]');
  const userPublicKey = data?.you?.id || "";
  let hasAttemptedInvalidSubmit = false;

  if (titleEl) {
    titleEl.textContent = "Add a friend";
  }
  if (myKeyEl) {
    myKeyEl.value = userPublicKey;
  }

  const setFriendKeyError = (message, isVisible) => {
    if (!friendKeyErrorEl) return;
    if (message) friendKeyErrorEl.textContent = message;
    friendKeyErrorEl.hidden = !isVisible;
  };

  const isSelfKey = () => {
    const value = (friendKeyEl?.value || "").trim();
    return value && value === userPublicKey;
  };

  const syncSubmitState = () => {
    if (!submitEl) return;
    const isValid = isValidNpub(friendKeyEl?.value || "");
    const isSelf = isSelfKey();
    const canSubmit = isValid && !isSelf;
    submitEl.classList.toggle("is-disabled", !canSubmit);
    submitEl.setAttribute("aria-disabled", String(!canSubmit));

    if (isSelf && hasAttemptedInvalidSubmit) {
      setFriendKeyError("You cannot add yourself as a friend", true);
    } else {
      setFriendKeyError("Add friends public key in correct format", !isValid && hasAttemptedInvalidSubmit);
    }
  };

  const setTrustSuggestionEnabled = (isEnabled) => {
    if (trustPanelEl) {
      trustPanelEl.hidden = !isEnabled;
    }
    if (trustExplainerEl) {
      trustExplainerEl.hidden = !isEnabled;
    }
    if (isEnabled) {
      trustLimitEl?.focus();
    }
  };

  const trustToggle = initCheckToggle(toggleEl, {
    checked: false,
    onChange: setTrustSuggestionEnabled,
  });

  myKeyEl?.addEventListener("click", () => {
    selectInputText(myKeyEl);
  });
  myKeyEl?.addEventListener("focus", () => {
    selectInputText(myKeyEl);
  });
  copyMyKeyButtonEl?.addEventListener("click", async () => {
    await copyTextToClipboard(userPublicKey, myKeyEl);
    selectInputText(myKeyEl);
  });
  friendKeyEl?.addEventListener("input", syncSubmitState);
  submitEl?.addEventListener("click", (event) => {
    const isValid = isValidNpub(friendKeyEl?.value || "");
    if (isValid && !isSelfKey()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    hasAttemptedInvalidSubmit = true;
    syncSubmitState();
    friendKeyEl?.focus();
  });
  syncSubmitState();

  // --- QR code generation ---
  if (myKeyQrEl && userPublicKey) {
    loadVendorScript("dist/js/vendor/qrcode.js", "QRCode").then((QRCode) => {
      const canvas = document.createElement("canvas");
      QRCode.toCanvas(canvas, encodeAddFriendUri(userPublicKey), {
        width: 180,
        margin: 2,
        color: { dark: "#1b1b1b", light: "#ffffff" },
      });
      myKeyQrEl.appendChild(canvas);
    }).catch(() => {
      // QR generation failed silently — key can still be copied
    });
  }

  // --- QR code scanning ---
  let html5Qrcode = null;

  const stopScanner = async () => {
    if (html5Qrcode) {
      try {
        await html5Qrcode.stop();
      } catch {
        // already stopped
      }
      html5Qrcode.clear();
      html5Qrcode = null;
    }
    if (scannerSectionEl) {
      scannerSectionEl.hidden = true;
    }
  };

  const onScanSuccess = (decodedText) => {
    const parsed = parseIouUri(decodedText);
    const key = parsed?.key || decodedText.trim();
    if (friendKeyEl) {
      friendKeyEl.value = key;
      friendKeyEl.dispatchEvent(new Event("input", { bubbles: true }));
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
      if (scannerSectionEl) {
        scannerSectionEl.hidden = false;
      }

      const readerId = `qr-reader-${Date.now()}`;
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

  // Clean up scanner when page is removed from DOM
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
      const isSuggestingTrust = trustToggle.isChecked();
      const trustLimit = isSuggestingTrust ? parseFloat(trustLimitEl?.value || "") : NaN;
      const friendId = friendKeyEl?.value?.trim?.() || "";
      return {
        friendId: isValidNpub(friendId) ? friendId : "",
        trustLimit,
      };
    },
  };
};
