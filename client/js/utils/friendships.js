/*
This module centralizes friendship-state constants and small predicates that the IOU client reuses across data, UI, and realtime networking code.

Keeping the status vocabulary in one place avoids stringly-typed conditionals spread across pages, and makes it easier to evolve pending or accepted friendship flows consistently.
*/

export const FRIENDSHIP_STATUS_ACCEPTED = "accepted";
export const FRIENDSHIP_STATUS_PENDING_OUTGOING = "pending_outgoing";
export const FRIENDSHIP_STATUS_PENDING_INCOMING = "pending_incoming";
export const FRIENDSHIP_STATUS_REJECTED = "rejected";

export const isAcceptedFriendshipStatus = (status) => {
  return status === FRIENDSHIP_STATUS_ACCEPTED;
};

export const isPendingFriendshipStatus = (status) => {
  return (
    status === FRIENDSHIP_STATUS_PENDING_OUTGOING ||
    status === FRIENDSHIP_STATUS_PENDING_INCOMING
  );
};

export const isPeerEligibleFriendshipStatus = (status) => {
  return isAcceptedFriendshipStatus(status) || isPendingFriendshipStatus(status);
};
