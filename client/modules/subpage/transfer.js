/*
Binds the "Transfer to another device" subpage.

User flow: enter a passphrase → encrypt the local private key via NIP-49
(scrypt + XChaCha20-Poly1305) → display the resulting `ncryptsec` bech32 blob
with a copy button. The passphrase + blob pair can be used on another device
(or another Nostr app) to recover the same identity. See
`client/js/crypto/nip49.js` for the encoding details.

The blob alone is useless without the passphrase — the authentication tag
fails to verify under any wrong key, so wrong-passphrase attempts on the
importing side cleanly throw rather than yielding a garbage key.
*/

import { encryptNcryptsec } from "../../js/crypto/nip49.js";
import { loadCurrentUserPrivateKeyHex } from "../../js/app-state.js";

const MIN_PASSPHRASE_LENGTH = 4;

const selectInputText = (inputEl) => {
  if (!inputEl) return;
  inputEl.focus();
  inputEl.select();
  if (typeof inputEl.setSelectionRange === "function") {
    inputEl.setSelectionRange(0, inputEl.value.length);
  }
};

const copyTextToClipboard = async (text, fallbackInputEl) => {
  const normalizedText = typeof text === "string" ? text : "";
  if (!normalizedText) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(normalizedText);
      return true;
    }
  } catch {
    // fall through
  }
  selectInputText(fallbackInputEl);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
};

export const bindTransfer = (root, data) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const passphraseEl = root.querySelector('[data-bind="transfer-passphrase"]');
  const togglePassphraseEl = root.querySelector('[data-action="toggle-passphrase"]');
  const errorEl = root.querySelector('[data-bind="passphrase-error"]');
  const submitEl = root.querySelector('[data-bind="encrypt-submit"]');
  const resultSectionEl = root.querySelector('[data-section="transfer-result"]');
  const ncryptsecDisplayEl = root.querySelector('[data-bind="ncryptsec-display"]');
  const copyButtonEl = root.querySelector('[data-action="copy-ncryptsec"]');
  const copyFeedbackEl = root.querySelector('[data-bind="copy-feedback"]');

  if (titleEl) titleEl.textContent = "Transfer user to new device";

  const setError = (message) => {
    if (!errorEl) return;
    if (message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    } else {
      errorEl.hidden = true;
    }
  };

  const syncSubmitState = () => {
    if (!submitEl) return;
    const canSubmit = (passphraseEl?.value || "").length >= MIN_PASSPHRASE_LENGTH;
    submitEl.classList.toggle("is-disabled", !canSubmit);
    submitEl.setAttribute("aria-disabled", String(!canSubmit));
  };

  passphraseEl?.addEventListener("input", () => {
    setError("");
    syncSubmitState();
    // Invalidate any previously generated blob — the passphrase drives it.
    if (resultSectionEl && !resultSectionEl.hidden) {
      resultSectionEl.hidden = true;
      if (ncryptsecDisplayEl) ncryptsecDisplayEl.value = "";
    }
  });

  togglePassphraseEl?.addEventListener("click", () => {
    if (!passphraseEl) return;
    const isHidden = passphraseEl.type === "password";
    passphraseEl.type = isHidden ? "text" : "password";
    togglePassphraseEl.setAttribute("aria-pressed", String(isHidden));
    togglePassphraseEl.setAttribute(
      "aria-label",
      isHidden ? "Hide passphrase" : "Show passphrase"
    );
  });

  submitEl?.addEventListener("click", async (event) => {
    event.preventDefault();
    const passphrase = passphraseEl?.value || "";
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      return;
    }

    const privateKeyHex = await loadCurrentUserPrivateKeyHex();
    if (!privateKeyHex) {
      setError("No key to transfer.");
      return;
    }

    submitEl.classList.add("is-disabled");
    submitEl.setAttribute("aria-disabled", "true");
    const originalLabel = submitEl.textContent;
    submitEl.textContent = "Encrypting…";

    // Yield a frame so the UI actually paints the disabled state before
    // scrypt locks the main thread for ~1s.
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    try {
      const ncryptsec = encryptNcryptsec(privateKeyHex, passphrase);
      if (ncryptsecDisplayEl) {
        ncryptsecDisplayEl.value = ncryptsec;
      }
      if (resultSectionEl) {
        resultSectionEl.hidden = false;
      }
      if (copyFeedbackEl) copyFeedbackEl.hidden = true;
    } catch (error) {
      setError(String(error?.message || "Failed to encrypt key."));
    } finally {
      submitEl.textContent = originalLabel;
      syncSubmitState();
    }
  });

  copyButtonEl?.addEventListener("click", async () => {
    const value = ncryptsecDisplayEl?.value || "";
    const copied = await copyTextToClipboard(value, ncryptsecDisplayEl);
    if (copyFeedbackEl) {
      copyFeedbackEl.textContent = copied ? "Copied to clipboard." : "Select and copy manually.";
      copyFeedbackEl.hidden = false;
    }
    selectInputText(ncryptsecDisplayEl);
  });

  ncryptsecDisplayEl?.addEventListener("focus", () => selectInputText(ncryptsecDisplayEl));
  ncryptsecDisplayEl?.addEventListener("click", () => selectInputText(ncryptsecDisplayEl));

  syncSubmitState();
};
