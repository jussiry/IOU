const STORAGE_KEY = "iou_state";
const VERSION_KEY = "iou_version";
export const APP_VERSION = "0.1.0";
let cachedState = null;

const safeLocalStorage = {
  get() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  },
  set(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (error) {
      // ignore write failures
    }
  },
};

export const ensureVersion = () => {
  try {
    const storedVersion = window.localStorage.getItem(VERSION_KEY);
    if (storedVersion !== APP_VERSION) {
      resetState();
      window.localStorage.setItem(VERSION_KEY, APP_VERSION);
    }
  } catch (error) {
    // ignore storage failures
  }
};

const fetchJson = async (path) => {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("Not found");
  return response.json();
};

const mergeBaseData = async (state) => {
  if (!state?.people) return state;
  let changed = false;

  const baseYou = await fetchJson("data/people/you.json");
  if (!state.people.you) {
    state.people.you = baseYou;
    return state;
  }

  const you = state.people.you;
  you.name = you.name || baseYou.name;
  you.connections = Array.isArray(you.connections) ? you.connections : [];

  const byId = new Map(you.connections.map((connection) => [connection.person_id, connection]));
  baseYou.connections.forEach((baseConnection) => {
    const existing = byId.get(baseConnection.person_id);
    if (!existing) {
      you.connections.push({ ...baseConnection });
      changed = true;
      return;
    }
    if (!existing.person_name && baseConnection.person_name) {
      existing.person_name = baseConnection.person_name;
      changed = true;
    }
    if (existing.trust_credit_limit_eur == null && baseConnection.trust_credit_limit_eur != null) {
      existing.trust_credit_limit_eur = baseConnection.trust_credit_limit_eur;
      changed = true;
    }
    if (!Array.isArray(existing.recent_transactions) && Array.isArray(baseConnection.recent_transactions)) {
      existing.recent_transactions = baseConnection.recent_transactions;
      changed = true;
    }
    if (existing.debt_eur == null && baseConnection.debt_eur != null) {
      existing.debt_eur = baseConnection.debt_eur;
      changed = true;
    }
  });

  await Promise.all(
    baseYou.connections.map(async (baseConnection) => {
      if (state.people[baseConnection.person_id]) return;
      try {
        const person = await fetchJson(`data/people/${baseConnection.person_id}.json`);
        state.people[baseConnection.person_id] = person;
        changed = true;
      } catch (error) {
        // ignore missing people files
      }
    })
  );

  if (changed) {
    safeLocalStorage.set(state);
  }

  return state;
};

const loadState = async () => {
  if (cachedState) return cachedState;
  const stored = safeLocalStorage.get();
  if (stored) {
    cachedState = await mergeBaseData(stored);
    return cachedState;
  }

  const you = await fetchJson("data/people/you.json");
  const connections = Array.isArray(you.connections) ? you.connections : [];

  const peopleEntries = await Promise.all(
    connections.map(async (connection) => {
      try {
        const person = await fetchJson(`data/people/${connection.person_id}.json`);
        return [connection.person_id, person];
      } catch (error) {
        return [connection.person_id, { id: connection.person_id, name: connection.person_name || connection.person_id, connections: [] }];
      }
    })
  );

  let logs = [];
  try {
    const logsData = await fetchJson("data/logs.json");
    logs = Array.isArray(logsData) ? logsData : [];
  } catch (error) {
    logs = [];
  }

  cachedState = {
    people: {
      you,
      ...Object.fromEntries(peopleEntries),
    },
    logs,
  };
  safeLocalStorage.set(cachedState);
  return cachedState;
};

const saveState = (state) => {
  cachedState = state;
  safeLocalStorage.set(state);
};

const buildView = (state) => {
  const you = state.people.you;
  const connections = Array.isArray(you.connections) ? you.connections : [];

  const inboundCredits = connections.map((connection) => {
    const person = state.people[connection.person_id];
    const backLink = person?.connections?.find((entry) => entry.person_id === "you");
    return backLink?.trust_credit_limit_eur || 0;
  });

  const connectionsWithInbound = connections.map((connection, index) => ({
    ...connection,
    person_name:
      state.people?.[connection.person_id]?.name ||
      connection.person_name ||
      connection.person_id,
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

  return {
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
    logs: Array.isArray(state.logs) ? state.logs : [],
  };
};

export const loadData = async () => {
  const state = await loadState();
  return buildView(state);
};

export const resetState = () => {
  cachedState = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // ignore clear failures
  }
};

const ensureConnection = (person, friendId, friendName) => {
  if (!person.connections) person.connections = [];
  let connection = person.connections.find((entry) => entry.person_id === friendId);
  if (!connection) {
    connection = {
      person_id: friendId,
      person_name: friendName,
      debt_eur: 0,
      trust_credit_limit_eur: 0,
      recent_transactions: [],
    };
    person.connections.push(connection);
  }
  if (!Array.isArray(connection.recent_transactions)) {
    connection.recent_transactions = [];
  }
  return connection;
};

const createId = (prefix = "tx") =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const createTransaction = async ({ friendId, amount, message }) => {
  if (!friendId || !amount || amount <= 0) {
    return loadData();
  }

  const state = await loadState();
  const you = state.people.you;
  const friend = state.people[friendId];
  const friendName = friend?.name || friendId;
  const trimmedMessage = message ? message.trim() : "";

  const youConnection = ensureConnection(you, friendId, friendName);
  const friendConnection = friend ? ensureConnection(friend, "you", "You") : null;

  youConnection.debt_eur = (youConnection.debt_eur || 0) - amount;
  if (friendConnection) {
    friendConnection.debt_eur = (friendConnection.debt_eur || 0) + amount;
  }

  const timestamp = new Date();
  const date = timestamp.toISOString().slice(0, 10);
  const txId = createId("tx");
  const note = trimmedMessage.length ? trimmedMessage : "IOU sent";

  youConnection.recent_transactions.unshift({
    id: txId,
    date,
    amount_eur: -amount,
    note,
  });

  if (friendConnection) {
    friendConnection.recent_transactions.unshift({
      id: txId,
      date,
      amount_eur: amount,
      note,
    });
  }

  const logId = createId("log");
  const logText = `You sent ${amount.toFixed(2)}€ to ${friendName}`;
  const logEntry = {
    id: logId,
    transaction_id: txId,
    timestamp: timestamp.toISOString(),
    text: logText,
    message: trimmedMessage,
    friend_id: friendId,
    amount_eur: amount,
  };

  state.logs = Array.isArray(state.logs) ? state.logs : [];
  state.logs.unshift(logEntry);

  saveState(state);
  return buildView(state);
};
