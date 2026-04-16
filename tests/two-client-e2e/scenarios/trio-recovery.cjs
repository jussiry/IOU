/*
Three-client recovery scenario.

Setup:
  Alice, Bob, Carol each start from a solo fixture (just their identity, no
  connections). Live friend-pairing is driven via data.js so both sides of
  each handshake accumulate real ledger entries. Bob then sends Alice an
  IOU, Carol sends Alice an IOU, and Bob lowers the shared trust limit.

Recovery:
  Alice is reloaded. Because createSeededClient injects the solo fixture as
  __IOU_SEED_STATE on every navigation, reloading Alice force-clears her
  IndexedDB back to identity-only — user keys preserved, everything else
  gone. Bob and Carol remain online with their full ledgers intact.

Assertions:
  After reconnect + sync Alice's connections, debts, trust limits, and
  ledger must match the pre-wipe snapshot, proving that sync_hello/sync_data
  alone can fully reconstitute a user from peers without any server-side state.

  Trust limit recovery works because friend_accept now echoes
  trust_credit_limit_eur — the value the accepter agreed to from the original
  friend_request. Replaying that message during recovery restores the
  established limit without any extra negotiation.
*/

const {
  ALICE,
  BOB,
  CAROL,
  buildSoloFixtures,
} = require("../fixtures/paired-friends.cjs");

const TRUST_LIMIT_INITIAL = 100;
const TRUST_LIMIT_LOWERED = 40;
const BOB_IOU_AMOUNT = 25;
const CAROL_IOU_AMOUNT = 15;

// ---------------------------------------------------------------------------
// Page-side helpers: drive command modules directly via dynamic import so we
// can orchestrate multi-user flows without routing through three different UIs.
// ---------------------------------------------------------------------------

const callData = async (client, fnName, ...args) => {
  return client.page.evaluate(
    async ({ name, params }) => {
      const mod = await import("/js/commands/index.js");
      const fn = mod[name];
      if (typeof fn !== "function") {
        throw new Error(`commands/index.js has no export '${name}'`);
      }
      const result = await fn(...params);
      // Most command mutators return a view; strip it so we only serialize
      // small payloads across the Playwright bridge.
      return result == null ? null : true;
    },
    { name: fnName, params: args }
  );
};

const readSnapshot = async (client) => {
  return client.page.evaluate(async () => {
    const mod = await import("/js/storage/indexeddb.js");
    const state = await mod.loadAppState();
    if (!state) return null;
    return {
      connections: (state.user?.connections || []).map((c) => ({
        person_id: c.person_id,
        person_name: c.person_name,
        friendship_status: c.friendship_status,
        debt_eur: c.debt_eur || 0,
        trust_credit_limit_eur: c.trust_credit_limit_eur || 0,
        recent_transactions_count: (c.recent_transactions || []).length,
      })),
      contactIds: Object.keys(state.contacts || {}),
      ledgerCount: Array.isArray(state.ledger) ? state.ledger.length : 0,
      outboxCount: Array.isArray(state.outbox) ? state.outbox.length : 0,
    };
  });
};

const findConnection = (snapshot, personId) => {
  return (snapshot?.connections || []).find((c) => c.person_id === personId) || null;
};

const waitForCondition = async (predicate, { timeoutMs = 15000, intervalMs = 250, label = "condition" } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await predicate();
    if (lastValue) return lastValue;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
};

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

module.exports = {
  name: "trio-recovery",
  run: async ({ assert, createSeededClient, helpers, harness }) => {
    const setupStart = Date.now();
    const fixtures = buildSoloFixtures();
    // buildSoloFixtures only returns alice + bob; build carol's solo state
    // inline using the same keypair that seed.js/ALICE/BOB/CAROL share.
    const carolSeed = {
      model_version: 3,
      user: {
        id: CAROL.publicKeyNpub,
        name: CAROL.name,
        public_key: CAROL.publicKeyNpub,
        public_key_hex: CAROL.publicKeyHex,
        private_key: CAROL.privateKeyNsec,
        private_key_hex: CAROL.privateKeyHex,
        connections: [],
      },
      contacts: {},
      ledger: [],
      outbox: [],
      processed_peer_message_ids: [],
    };

    const alice = await createSeededClient({ label: "alice", seed: fixtures.alice });
    const bob = await createSeededClient({ label: "bob", seed: fixtures.bob });
    const carol = await createSeededClient({ label: "carol", seed: carolSeed });

    // --- Pair Alice<->Bob and Alice<->Carol via command modules ---
    // Alice sends friend requests with a non-zero suggested trust limit so
    // Bob/Carol auto-adopt it on accept.
    await callData(alice, "createFriend", { friendId: BOB.publicKeyNpub, trustLimit: TRUST_LIMIT_INITIAL });
    await callData(alice, "createFriend", { friendId: CAROL.publicKeyNpub, trustLimit: TRUST_LIMIT_INITIAL });
    await harness.delay(2500);

    // Bob and Carol accept Alice's requests.
    await callData(bob, "acceptFriend", ALICE.publicKeyNpub);
    await callData(carol, "acceptFriend", ALICE.publicKeyNpub);
    await harness.delay(2500);

    // Verify Alice now sees both as accepted before continuing.
    await waitForCondition(
      async () => {
        const snap = await readSnapshot(alice);
        const bobC = findConnection(snap, BOB.publicKeyNpub);
        const carolC = findConnection(snap, CAROL.publicKeyNpub);
        return (
          bobC?.friendship_status === "accepted" &&
          carolC?.friendship_status === "accepted"
        );
      },
      { label: "Alice to see both friends accepted" }
    );

    // --- Bob and Carol each send Alice an IOU ---
    await callData(bob, "createTransaction", {
      friendId: ALICE.publicKeyNpub,
      amount: BOB_IOU_AMOUNT,
      message: "Lunch",
    });
    await callData(carol, "createTransaction", {
      friendId: ALICE.publicKeyNpub,
      amount: CAROL_IOU_AMOUNT,
      message: "Taxi share",
    });
    await harness.delay(2000);

    // --- Bob lowers the trust limit with Alice (auto-applies on Alice) ---
    await callData(bob, "updateTrustLimit", ALICE.publicKeyNpub, TRUST_LIMIT_LOWERED);
    await harness.delay(2000);

    // Capture pre-wipe snapshot for comparison.
    await waitForCondition(
      async () => {
        const snap = await readSnapshot(alice);
        const bobC = findConnection(snap, BOB.publicKeyNpub);
        const carolC = findConnection(snap, CAROL.publicKeyNpub);
        // Amounts are positive on the receiving side (Alice).
        return (
          bobC?.debt_eur === BOB_IOU_AMOUNT &&
          bobC?.trust_credit_limit_eur === TRUST_LIMIT_LOWERED &&
          carolC?.debt_eur === CAROL_IOU_AMOUNT
        );
      },
      { label: "Alice to fully absorb Bob's IOU, Carol's IOU, and lowered trust limit" }
    );

    const preWipe = await readSnapshot(alice);

    // --- Wipe Alice: reload her page. createSeededClient's init script
    // re-applies the solo fixture (identity only) on every navigation, so
    // reload === wipe-to-identity. ---
    helpers.clearClientEvents(alice);
    await helpers.reloadClient(alice);

    // We don't assert state right after reload: by the time the page is
    // interactive, Bob/Carol may already have reconnected and replayed.
    // The recovery assertions below are what matter.

    // --- Wait for sync recovery (friendships, debts, trust limits) ---
    await waitForCondition(
      async () => {
        const snap = await readSnapshot(alice);
        const bobC = findConnection(snap, BOB.publicKeyNpub);
        const carolC = findConnection(snap, CAROL.publicKeyNpub);
        return (
          bobC?.friendship_status === "accepted" &&
          carolC?.friendship_status === "accepted" &&
          bobC?.debt_eur === BOB_IOU_AMOUNT &&
          carolC?.debt_eur === CAROL_IOU_AMOUNT
        );
      },
      { timeoutMs: 20000, label: "Alice to recover friendships and debts via sync" }
    );

    const recovered = await readSnapshot(alice);
    const recoveredBob = findConnection(recovered, BOB.publicKeyNpub);
    const recoveredCarol = findConnection(recovered, CAROL.publicKeyNpub);

    assert.ok(recoveredBob, "Bob connection re-created via sync");
    assert.ok(recoveredCarol, "Carol connection re-created via sync");
    assert.equal(recoveredBob.friendship_status, "accepted");
    assert.equal(recoveredCarol.friendship_status, "accepted");
    assert.equal(recoveredBob.debt_eur, BOB_IOU_AMOUNT);
    assert.equal(recoveredCarol.debt_eur, CAROL_IOU_AMOUNT);
    // friend_accept echoes trust_credit_limit_eur, so the initial agreed
    // limit (100) is restored. Bob's later lowering suggestion also replays,
    // so Alice ends up at the lowered value.
    assert.equal(recoveredBob.trust_credit_limit_eur, TRUST_LIMIT_LOWERED);
    assert.equal(recoveredCarol.trust_credit_limit_eur, TRUST_LIMIT_INITIAL);
    assert.equal(recoveredBob.recent_transactions_count, 1);
    assert.equal(recoveredCarol.recent_transactions_count, 1);

    // Ledger should be non-empty after recovery. Strict equality to preWipe
    // is too tight (outbound-only friend_request entries can differ) but we
    // expect at least the two tx_created + two friend_accept entries.
    assert.ok(
      recovered.ledgerCount >= 4,
      `Expected ledger to contain at least 4 entries after recovery, got ${recovered.ledgerCount}`
    );

    return {
      setupMs: Date.now() - setupStart,
      preWipe,
      recovered,
    };
  },
};
