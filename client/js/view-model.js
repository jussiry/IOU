/*
Derives a read-only view model from persisted app state.

The view model aggregates balance totals, credit agreements, and connection
data so that page binders never need to compute these values themselves.
*/

import { createPublicPersonModel } from "./models/data-model.js";
import { isAcceptedFriendshipStatus } from "./utils/friendships.js";

export const buildView = (state) => {
  const user = state.user;
  const connections = Array.isArray(user.connections) ? user.connections : [];

  const connectionsWithInbound = connections.map((connection) => {
    const contact = state.contacts?.[connection.person_id];
    const backLink = contact?.connections?.find(
      (entry) => entry.person_id === user.id
    );
    const inboundCreditLimit = backLink?.trust_credit_limit_eur || 0;

    return {
      ...connection,
      person_name: contact?.name || connection.person_name || connection.person_id,
      inbound_credit_limit_eur: inboundCreditLimit,
    };
  });

  const acceptedConnections = connectionsWithInbound.filter((connection) =>
    isAcceptedFriendshipStatus(connection.friendship_status)
  );

  const creditAgreements = acceptedConnections.reduce((sum, connection) => {
    return sum + (connection.trust_credit_limit_eur || 0);
  }, 0);

  const friendsOweTotal = acceptedConnections.reduce((sum, connection) => {
    return sum + Math.max(connection.debt_eur || 0, 0);
  }, 0);
  const youOweTotal = acceptedConnections.reduce((sum, connection) => {
    return sum + Math.max(-(connection.debt_eur || 0), 0);
  }, 0);
  const netBalance = friendsOweTotal - youOweTotal;

  const availableCredit = acceptedConnections.reduce((sum, connection) => {
    const creditLimit = connection.inbound_credit_limit_eur || 0;
    const debtUsed = Math.max(connection.debt_eur || 0, 0);
    const remainingCredit = Math.max(creditLimit - debtUsed, 0);
    return sum + remainingCredit;
  }, 0);

  return {
    you: createPublicPersonModel(user),
    connections: connectionsWithInbound,
    totals: {
      netBalance,
      friendsOweTotal,
      youOweTotal,
      creditAgreements,
      availableCredit,
    },
    logs: Array.isArray(state.logs) ? state.logs : [],
  };
};
