/*
This module defines the peer-to-peer message types and small helpers used by the IOU realtime layer.

By keeping transport message names and envelope helpers together, the data layer and WebRTC transport can share one message contract without duplicating literal strings in multiple modules.
*/

export const PEER_MESSAGE_TYPE_FRIEND_REQUEST = "friend_request";
export const PEER_MESSAGE_TYPE_FRIEND_ACCEPT = "friend_accept";
export const PEER_MESSAGE_TYPE_FRIEND_REJECT = "friend_reject";
export const PEER_MESSAGE_TYPE_TRUST_LIMIT_SUGGESTION = "credit_limit_suggestion";
export const PEER_MESSAGE_TYPE_TRANSACTION_CREATED = "transaction_created";
export const PEER_MESSAGE_TYPE_NAME_CHANGED = "name_changed";
export const PEER_MESSAGE_TYPE_PAYMENT_REQUEST = "payment_request";
export const PEER_MESSAGE_TYPE_PAYMENT_REQUEST_RESPONSE = "payment_request_response";
export const PEER_MESSAGE_TYPE_PING = "ping";
export const PEER_MESSAGE_TYPE_PONG = "pong";
export const PEER_MESSAGE_TYPE_RECEIVED = "received";
export const PEER_MESSAGE_TYPE_SYNC_HELLO = "sync_hello";
export const PEER_MESSAGE_TYPE_SYNC_DATA = "sync_data";
export const PEER_RECEIPT_RESULT_PROCESSED = "peer_processed";
export const PEER_RECEIPT_RESULT_IGNORED = "peer_ignored";

const createRuntimeMessageId = () => {
  if (window.crypto?.randomUUID) {
    return `peer_${window.crypto.randomUUID()}`;
  }

  const randomToken = Math.random().toString(36).slice(2, 10);
  return `peer_${Date.now().toString(36)}_${randomToken}`;
};

export const createPeerReceiptMessage = ({
  fromUserId,
  toUserId,
  messageId,
  result = PEER_RECEIPT_RESULT_PROCESSED,
}) => {
  return {
    id: createRuntimeMessageId(),
    type: PEER_MESSAGE_TYPE_RECEIVED,
    from_user_id: fromUserId,
    to_user_id: toUserId,
    created_at: new Date().toISOString(),
    payload: {
      message_id: messageId,
      result,
    },
  };
};
