/*
Derives a read-only view model from persisted app state.

The view model aggregates balance totals, trust agreements, and connection
data so that page binders never need to compute these values themselves.
*/

import { createPublicPersonModel } from "../models/data-model.js";
import { isAcceptedFriendshipStatus } from "../utils/friendships.js";

export const buildView = (state) => {
  const user = state.user;
  const friends = Array.isArray(user.friends) ? user.friends : [];

  const friendsWithInbound = friends.map((friend) => {
    const contact = state.contacts?.[friend.person_id];

    return {
      ...friend,
      person_name: contact?.name || friend.person_name || friend.person_id,
    };
  });

  const acceptedFriends = friendsWithInbound.filter((friend) =>
    isAcceptedFriendshipStatus(friend.friendship_status)
  );

  const trustAgreements = acceptedFriends.reduce((sum, friend) => {
    return sum + (friend.trust_credit_limit_eur || 0);
  }, 0);

  const friendsOweTotal = acceptedFriends.reduce((sum, friend) => {
    return sum + Math.max(friend.debt_eur || 0, 0);
  }, 0);
  const youOweTotal = acceptedFriends.reduce((sum, friend) => {
    return sum + Math.max(-(friend.debt_eur || 0), 0);
  }, 0);
  const netBalance = friendsOweTotal - youOweTotal;

  const availableTrust = acceptedFriends.reduce((sum, friend) => {
    const trustLimit = friend.trust_credit_limit_eur || 0;
    const debt = friend.debt_eur || 0;
    return sum + Math.max(trustLimit + debt, 0);
  }, 0);

  return {
    you: createPublicPersonModel(user),
    connections: friendsWithInbound,
    totals: {
      netBalance,
      friendsOweTotal,
      youOweTotal,
      trustAgreements,
      availableTrust,
    },
    ledger: Array.isArray(state.ledger) ? state.ledger : [],
  };
};
