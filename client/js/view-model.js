/*
Derives a read-only view model from persisted app state.

The view model aggregates balance totals, trust agreements, and connection
data so that page binders never need to compute these values themselves.
*/

import { createPublicPersonModel } from "./models/data-model.js";
import { isAcceptedFriendshipStatus } from "./utils/friendships.js";

export const buildView = (state) => {
  const user = state.user;
  const connections = Array.isArray(user.connections) ? user.connections : [];

  const connectionsWithInbound = connections.map((connection) => {
    const contact = state.contacts?.[connection.person_id];

    return {
      ...connection,
      person_name: contact?.name || connection.person_name || connection.person_id,
    };
  });

  const acceptedConnections = connectionsWithInbound.filter((connection) =>
    isAcceptedFriendshipStatus(connection.friendship_status)
  );

  const trustAgreements = acceptedConnections.reduce((sum, connection) => {
    return sum + (connection.trust_credit_limit_eur || 0);
  }, 0);

  const friendsOweTotal = acceptedConnections.reduce((sum, connection) => {
    return sum + Math.max(connection.debt_eur || 0, 0);
  }, 0);
  const youOweTotal = acceptedConnections.reduce((sum, connection) => {
    return sum + Math.max(-(connection.debt_eur || 0), 0);
  }, 0);
  const netBalance = friendsOweTotal - youOweTotal;

  const availableTrust = acceptedConnections.reduce((sum, connection) => {
    const trustLimit = connection.trust_credit_limit_eur || 0;
    const debt = connection.debt_eur || 0;
    return sum + Math.max(trustLimit + debt, 0);
  }, 0);

  return {
    you: createPublicPersonModel(user),
    connections: connectionsWithInbound,
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
