/*
This scenario validates that browser reloads re-establish WebRTC peer
connections without negotiation errors. It covers both a single reload and
two quick successive reloads to catch stale-description races where a second
reconnect starts before the previous renegotiation has fully drained.

Uses pre-seeded IndexedDB fixtures so the two clients boot already paired as
friends, skipping the welcome flow and friend-request handshake which are
covered by other scenarios.
*/

const { buildPairedFriendsFixtures } = require("../fixtures/paired-friends.cjs");

const NEGOTIATION_ERROR_PATTERN =
  /have-remote-offer|setLocalDescription|set remote offer or answer|ICE restart|ice-ufrag|ice-pwd|Cannot set local offer/i;

const ONLINE_ICON_CLASS = "friend-icon friend-icon--online";

const assertReconnected = async (assert, helpers, alice, bob) => {
  await helpers.waitForPeerConnectionCount(alice, 1);
  await helpers.waitForPeerConnectionCount(bob, 1);

  const icons = {
    alice: await helpers.getFriendIconClass(alice),
    bob: await helpers.getFriendIconClass(bob),
  };
  assert.equal(icons.alice, ONLINE_ICON_CLASS);
  assert.equal(icons.bob, ONLINE_ICON_CLASS);

  const aliceErrors = helpers.getClientErrors(alice, NEGOTIATION_ERROR_PATTERN);
  const bobErrors = helpers.getClientErrors(bob, NEGOTIATION_ERROR_PATTERN);
  assert.equal(aliceErrors.length, 0);
  assert.equal(bobErrors.length, 0);

  return { icons, aliceErrors, bobErrors };
};

module.exports = {
  name: "reload-reconnect",
  run: async ({ assert, createSeededClient, helpers, harness }) => {
    const setupStart = Date.now();
    const fixtures = buildPairedFriendsFixtures();
    const alice = await createSeededClient({
      label: "alice",
      seed: fixtures.alice,
    });
    const bob = await createSeededClient({
      label: "bob",
      seed: fixtures.bob,
    });

    await harness.delay(3000);

    assert.equal(await helpers.getPeerConnectionCount(alice), "1");
    assert.equal(await helpers.getPeerConnectionCount(bob), "1");
    const setupMs = Date.now() - setupStart;

    // --- Single reload ---
    helpers.clearClientEvents(alice);
    helpers.clearClientEvents(bob);

    await helpers.clickNav(bob, "friends", "#page-content");
    await helpers.reloadClient(bob, 'nav [data-page="friends"]');

    const singleReload = await assertReconnected(assert, helpers, alice, bob);

    // --- Double quick reload ---
    helpers.clearClientEvents(alice);
    helpers.clearClientEvents(bob);

    await helpers.clickNav(bob, "friends", "#page-content");
    await helpers.reloadClient(bob, 'nav [data-page="friends"]');
    await harness.delay(1500);
    await helpers.reloadClient(bob, 'nav [data-page="friends"]');

    const doubleReload = await assertReconnected(assert, helpers, alice, bob);

    return {
      setupMs,
      singleReload,
      doubleReload,
      aliceTransportTail: helpers.getTransportLogs(alice).slice(-20),
      bobTransportTail: helpers.getTransportLogs(bob).slice(-20),
    };
  },
};
