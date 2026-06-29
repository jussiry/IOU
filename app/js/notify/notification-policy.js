/*
Notification policy — the single place that describes Tally's notification
layers and decides which peer events deserve an OS-level push.

The app surfaces "something happened" through four distinct layers, each with a
different audience, lifetime, and trigger:

  1. Logs (js/ui/realtime-log or the activity log)
     Every realtime event. Diagnostic, derived automatically from the ledger;
     never user-facing as an alert.

  2. In-app toasts (js/ui/notifications.js)
     Almost all inbound events, shown only while the app is open and focused.
     Transient acknowledgement that the UI just changed.

  3. Actionable boxes (the friend page, derived from app state)
     Persistent, state-derived prompts that need a decision — pending friend
     requests, pending payment requests, trust-limit suggestions. They live as
     long as the state that produced them.

  4. OS notifications (Web Push -> service worker -> showNotification)
     The only layer that reaches the user when the app is closed. Reserved for
     a small set of high-signal events, because an OS notification interrupts.

This module owns the layer-4 decision. `buildOsNotificationHint` maps an
outgoing peer message to the short title/body the *recipient* should see, or
null for message types that should never raise an OS notification (sync,
receipts, name changes, trust-limit chatter). The sender builds the hint —
it has the human-readable context (its own name, the amount) — encrypts it for
the recipient, and the relay forwards it via Web Push only when no device of
the recipient is online. See TIPs/TIP-004-os-notifications.md.

Keeping this mapping separate from the state-mutation handlers (peer/handlers.js)
means the "what shows where" question has one answer, and adding a new
OS-notifiable event is a single edit here rather than scattered string-building.
@category ui
*/

import { formatCurrency } from "../ui/format.js";
import {
  PEER_MESSAGE_TYPE_FRIEND_REQUEST,
  PEER_MESSAGE_TYPE_PAYMENT_REQUEST,
  PEER_MESSAGE_TYPE_TRANSACTION_CREATED,
} from "../peer/messages.js";

const APP_NAME = "Tally";

const normalizeAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

// Builders are keyed by message type. Each receives the outgoing peer message
// and the sender's display name (the recipient sees the sender's name, e.g.
// "Bob sent you €25.00"). Returning null means "no OS notification".
const HINT_BUILDERS = {
  [PEER_MESSAGE_TYPE_TRANSACTION_CREATED]: (message, senderName) => {
    const amount = normalizeAmount(message.payload?.amount_eur);
    if (amount === null) return null;
    return {
      title: APP_NAME,
      body: `${senderName} sent you ${formatCurrency(amount)}`,
    };
  },
  [PEER_MESSAGE_TYPE_PAYMENT_REQUEST]: (message, senderName) => {
    const amount = normalizeAmount(message.payload?.amount_eur);
    if (amount === null) return null;
    const note = typeof message.payload?.note === "string" ? message.payload.note.trim() : "";
    const base = `${senderName} requested ${formatCurrency(amount)}`;
    return {
      title: APP_NAME,
      body: note ? `${base} — ${note}` : base,
    };
  },
  [PEER_MESSAGE_TYPE_FRIEND_REQUEST]: (message, senderName) => ({
    title: APP_NAME,
    body: `${senderName} sent you a friend request`,
  }),
};

// True when a message type can raise an OS notification on the recipient.
export const isOsNotifiableType = (type) => Boolean(HINT_BUILDERS[type]);

// Build the OS-notification hint a recipient should see for an outgoing peer
// message, or null when this message type/payload warrants none. `senderName`
// falls back to a generic label so a missing name never produces "undefined".
export const buildOsNotificationHint = (message, { senderName } = {}) => {
  if (!message || typeof message !== "object") return null;
  const builder = HINT_BUILDERS[message.type];
  if (!builder) return null;
  const name = (typeof senderName === "string" && senderName.trim()) || "A friend";
  return builder(message, name);
};

// Shown when the service worker receives a push but cannot decrypt the hint
// (e.g. no local key yet, or the user signed out). Generic on purpose.
export const GENERIC_OS_NOTIFICATION = {
  title: APP_NAME,
  body: "You have new Tally activity",
};
