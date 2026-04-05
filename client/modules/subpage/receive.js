/*
This module binds the receive subpage. It generates a QR code encoding the
user's public key along with optional amount and note so that a sender can
scan it to pre-fill their send form.

The QR code updates live as the user types, with a short debounce to avoid
excessive re-renders.
*/

import { loadVendorScript } from "../../js/utils/vendor-loader.js";
import { encodePayUri } from "../../js/utils/qr-uri.js";

const QR_UPDATE_DEBOUNCE_MS = 300;

export const bindReceive = (root, data) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const amountEl = root.querySelector('[data-bind="receive-amount"]');
  const messageEl = root.querySelector('[data-bind="receive-message"]');
  const qrEl = root.querySelector('[data-bind="receive-qr"]');
  const userPublicKey = data?.you?.id || "";

  if (titleEl) titleEl.textContent = "Receive IOU";

  if (messageEl) {
    const autoGrow = () => {
      messageEl.style.height = "auto";
      messageEl.style.height = messageEl.scrollHeight + "px";
    };
    messageEl.addEventListener("input", autoGrow);
  }

  if (!userPublicKey || !qrEl) {
    return;
  }

  let QRCode = null;
  let debounceTimer = null;

  const renderQr = () => {
    if (!QRCode) return;

    const amount = amountEl ? parseFloat(amountEl.value) : 0;
    const note = messageEl ? messageEl.value.trim() : "";
    const uri = encodePayUri(
      userPublicKey,
      Number.isFinite(amount) && amount > 0 ? amount : null,
      note || null,
    );

    qrEl.innerHTML = "";
    const canvas = document.createElement("canvas");
    QRCode.toCanvas(canvas, uri, {
      width: 200,
      margin: 2,
      color: { dark: "#1b1b1b", light: "#ffffff" },
    });
    qrEl.appendChild(canvas);
  };

  const scheduleRender = () => {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      renderQr();
    }, QR_UPDATE_DEBOUNCE_MS);
  };

  amountEl?.addEventListener("input", scheduleRender);
  messageEl?.addEventListener("input", scheduleRender);

  // Load QR library and render initial code (key-only)
  loadVendorScript("js/vendor/qrcode.js", "QRCode")
    .then((lib) => {
      QRCode = lib;
      renderQr();
    })
    .catch(() => {
      // QR generation failed silently
    });
};
