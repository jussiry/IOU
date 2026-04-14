/*
This module binds the request subpage. It provides two tabs:

1. "Send request" — select a friend, enter amount and note, and send a payment
   request that appears as an actionable notification on the friend's side.
2. "Use QR code" — generate a QR code encoding the user's public key with
   optional amount and note so a sender can scan it.

Tab state is local to this page visit; switching tabs shows/hides panels.
*/

import { isAcceptedFriendshipStatus } from "../../js/utils/friendships.js";
import { loadVendorScript } from "../../js/utils/vendor-loader.js";
import { encodePayUri } from "../../js/utils/qr-uri.js";

const QR_UPDATE_DEBOUNCE_MS = 300;

const bindTabs = (root) => {
  const tabs = root.querySelectorAll("[data-tab]");
  const panels = root.querySelectorAll("[data-panel]");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle("request-tab--active", t.dataset.tab === target));
      panels.forEach((p) => {
        p.hidden = p.dataset.panel !== target;
      });
    });
  });
};

const bindRequestFriend = (root, data) => {
  const selectEl = root.querySelector('[data-bind="request-to"]');
  const amountEl = root.querySelector('[data-bind="request-amount"]');
  const messageEl = root.querySelector('[data-bind="request-message"]');
  const submitEl = root.querySelector('[data-bind="request-submit"]');

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
    .sort((a, b) => {
      const aName = a.person_name || a.person_id || "";
      const bName = b.person_name || b.person_id || "";
      return aName.localeCompare(bName);
    });

  if (!acceptedConnections.length) {
    const panel = root.querySelector('[data-panel="request-friend"]');
    if (panel) {
      const hasAny = allConnections.length > 0;
      panel.innerHTML = hasAny
        ? `<div class="send-empty-state empty">
            No accepted friends yet. Complete a pending friendship or <a class="send-empty-link" href="#add-friend">add a new friend</a>
            before requesting a payment.
          </div>`
        : `<div class="send-empty-state empty">
            No friends exist. <a class="send-empty-link" href="#add-friend">Add a new friend</a> to
            request your first payment.
          </div>`;
    }
    return { submitEl: null, getPayload: () => ({ friendId: "", amount: NaN, message: "" }) };
  }

  if (selectEl) {
    selectEl.innerHTML = "";
    acceptedConnections.forEach((connection) => {
      const option = document.createElement("option");
      option.value = connection.person_id;
      option.textContent = connection.person_name || connection.person_id;
      selectEl.appendChild(option);
    });
  }

  return {
    submitEl,
    getPayload: () => {
      const selectedId = selectEl?.value || acceptedConnections[0]?.person_id || "";
      const amount = amountEl ? parseFloat(amountEl.value) : NaN;
      const message = messageEl ? messageEl.value : "";
      return { friendId: selectedId, amount, message };
    },
  };
};

const bindQrCode = (root, data) => {
  const amountEl = root.querySelector('[data-bind="qr-amount"]');
  const messageEl = root.querySelector('[data-bind="qr-message"]');
  const qrEl = root.querySelector('[data-bind="request-qr"]');
  const userPublicKey = data?.you?.id || "";

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

  loadVendorScript("js/vendor/qrcode.js", "QRCode")
    .then((lib) => {
      QRCode = lib;
      renderQr();
    })
    .catch(() => {
      // QR generation failed silently
    });
};

export const bindRequest = (root, data) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  if (titleEl) titleEl.textContent = "Request";

  bindTabs(root);
  const requestResult = bindRequestFriend(root, data);
  bindQrCode(root, data);

  return requestResult;
};
