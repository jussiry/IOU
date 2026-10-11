/*
Own-device sync through the relay when WebRTC can't connect.

Setup:
  Alice runs on two devices ("alice-laptop" and "alice-phone"), paired with
  Bob (who stays offline — he only gives Alice someone to pay). Both Alice
  devices force `iceTransportPolicy: "relay"` with no TURN server, so they
  gather no usable ICE candidates and the self-mesh never opens. That mirrors
  real networks where STUN alone can't traverse the NAT.

Flow:
  1. The laptop records a payment while the phone is still offline.
  2. The phone comes online → its sync_hello over the relay must pull the
     laptop's entry (catch-up path).
  3. The phone records a payment → the live broadcast over the relay must
     reach the laptop (push path).

Assertions:
  Both entries end up on both devices, with no self-mesh channel ever open.
*/

const { BOB, buildPairedFriendsFixtures } = require("../fixtures/paired-friends.cjs");

const SYNC_TIMEOUT_MS = 15000;

// Runs in the page before any app code: every RTCPeerConnection is limited
// to TURN relay candidates, and there is no TURN server, so ICE can't succeed.
const blockDirectWebRtc = () => {
  const NativePeerConnection = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeerConnection {
    constructor(config = {}) {
      super({ ...config, iceTransportPolicy: "relay" });
    }
  };
};

// Fire-and-poll instead of awaiting createTransaction inside page.evaluate:
// under the relay-sync load, Chromium intermittently reports the evaluate's
// pending promise as "collected" (surfaced by Playwright as "Execution context
// was destroyed") even though the payment completes. Holding the promise on
// window and polling a flag sidesteps that test-harness quirk.
const pay = async (client, amount) => {
  await client.page.evaluate(({ friendId, amount }) => {
    window.__e2ePay = { done: false, error: null };
    window.__e2ePayPromise = import("/dist/js/commands/index.js")
      .then((commands) => commands.createTransaction({ friendId, amount, message: `e2e ${amount}` }))
      .then(() => { window.__e2ePay.done = true; }, (e) => { window.__e2ePay.error = String(e); });
  }, { friendId: BOB.publicKeyNpub, amount });
  await client.page.waitForFunction(() => window.__e2ePay.done || window.__e2ePay.error, null, { timeout: 10000 });
  const result = await client.page.evaluate(() => window.__e2ePay);
  if (result.error) throw new Error(`${client.label} payment failed: ${result.error}`);
};

const readState = (client) =>
  client.page.evaluate(async () => {
    const storage = await import("/dist/js/storage/indexeddb.js");
    const status = await import("/dist/js/peer/status.js");
    const state = await storage.loadAppState();
    return {
      ledgerIds: (state?.ledger || []).map((entry) => entry.id),
      selfChannels: status.getConnectedSelfDeviceIds().length,
    };
  });

const waitForLedgerIds = async (harness, client, ids) => {
  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  let state;
  while (Date.now() < deadline) {
    state = await readState(client);
    if (ids.every((id) => state.ledgerIds.includes(id))) return state;
    await harness.delay(250);
  }
  throw new Error(`${client.label} never received ledger entries ${ids.join(", ")}`);
};

const newLedgerIds = (before, after) =>
  after.ledgerIds.filter((id) => !before.ledgerIds.includes(id));

module.exports = {
  name: "self-relay-sync",
  run: async ({ assert, createSeededClient, harness }) => {
    const fixtures = buildPairedFriendsFixtures();
    const initScripts = [blockDirectWebRtc];

    const laptop = await createSeededClient({ label: "alice-laptop", seed: fixtures.alice, initScripts });
    const laptopBefore = await readState(laptop);
    await pay(laptop, 7);
    const laptopAfter = await readState(laptop);
    const laptopEntryIds = newLedgerIds(laptopBefore, laptopAfter);
    assert.ok(laptopEntryIds.length > 0, "laptop payment created no ledger entry");

    // Catch-up: the phone joins later and must pull the laptop's entry.
    const phone = await createSeededClient({ label: "alice-phone", seed: fixtures.alice, initScripts });
    const phoneCaughtUp = await waitForLedgerIds(harness, phone, laptopEntryIds);

    // Live push: a new phone entry must reach the laptop.
    await pay(phone, 11);
    const phoneAfter = await readState(phone);
    const phoneEntryIds = newLedgerIds(phoneCaughtUp, phoneAfter);
    assert.ok(phoneEntryIds.length > 0, "phone payment created no ledger entry");
    const laptopFinal = await waitForLedgerIds(harness, laptop, phoneEntryIds);

    assert.equal(laptopFinal.selfChannels, 0, "test setup broken: WebRTC self channel opened");
    assert.equal(phoneAfter.selfChannels, 0, "test setup broken: WebRTC self channel opened");

    return {
      laptopEntryIds,
      phoneEntryIds,
      laptopLedger: laptopFinal.ledgerIds.length,
      phoneLedger: (await readState(phone)).ledgerIds.length,
    };
  },
};
