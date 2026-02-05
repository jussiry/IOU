let cachedData = null;

export const loadData = async () => {
  if (cachedData) return cachedData;

  const youResponse = await fetch("data/people/you.json", { cache: "no-store" });
  const you = await youResponse.json();
  const connections = Array.isArray(you.connections) ? you.connections : [];

  const inboundCredits = await Promise.all(
    connections.map(async (connection) => {
      try {
        const response = await fetch(`data/people/${connection.person_id}.json`, {
          cache: "no-store",
        });
        if (!response.ok) return 0;
        const person = await response.json();
        const backLink = (person.connections || []).find(
          (entry) => entry.person_id === "you"
        );
        return backLink?.trust_credit_limit_eur || 0;
      } catch (error) {
        return 0;
      }
    })
  );

  const connectionsWithInbound = connections.map((connection, index) => ({
    ...connection,
    inbound_credit_limit_eur: inboundCredits[index] || 0,
  }));

  const creditFromOthers = connectionsWithInbound.reduce(
    (sum, connection) => sum + (connection.inbound_credit_limit_eur || 0),
    0
  );
  const creditYouExtend = connectionsWithInbound.reduce(
    (sum, connection) => sum + (connection.trust_credit_limit_eur || 0),
    0
  );

  const friendsOweTotal = connectionsWithInbound.reduce(
    (sum, connection) => sum + Math.max(connection.debt_eur || 0, 0),
    0
  );
  const youOweTotal = connectionsWithInbound.reduce(
    (sum, connection) => sum + Math.max(-(connection.debt_eur || 0), 0),
    0
  );
  const netBalance = friendsOweTotal - youOweTotal;

  const availableCredit = connectionsWithInbound.reduce((sum, connection) => {
    const creditLimit = connection.inbound_credit_limit_eur || 0;
    const debtUsed = Math.max(connection.debt_eur || 0, 0);
    const remaining = Math.max(creditLimit - debtUsed, 0);
    return sum + remaining;
  }, 0);

  cachedData = {
    you,
    connections: connectionsWithInbound,
    totals: {
      netBalance,
      friendsOweTotal,
      youOweTotal,
      creditFromOthers,
      creditYouExtend,
      availableCredit,
    },
  };

  return cachedData;
};
