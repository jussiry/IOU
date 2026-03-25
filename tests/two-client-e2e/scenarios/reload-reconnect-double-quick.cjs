/*
This scenario validates two quick successive reloads on the same client. It targets stale-description races that can show up when a second reconnect attempt starts before the previous renegotiation has fully drained.

The scenario uses the same assertions as the single-reload test, but performs a second reload after a short pause so we can specifically guard against repeated Firefox reconnect failures.
*/

const NEGOTIATION_ERROR_PATTERN =
  /have-remote-offer|setLocalDescription|set remote offer or answer|ICE restart|ice-ufrag|ice-pwd|Cannot set local offer/i;

const ONLINE_ICON_CLASS = "friend-icon friend-icon--online";

module.exports = {
  name: "reload-reconnect-double-quick",
  run: async ({ assert, createClient, helpers, harness }) => {
    const alice = await createClient({
      label: "alice",
      userName: "Alice",
    });
    const bob = await createClient({
      label: "bob",
      userName: "Bob",
    });

    const bobKey = await helpers.readMyKey(bob);
    await helpers.submitFriendRequest(alice, bobKey);
    await helpers.waitForFriendRows(bob, 1);
    await helpers.acceptFirstFriend(bob);
    await harness.delay(3000);

    assert.equal(await helpers.getPeerConnectionCount(alice), "1");
    assert.equal(await helpers.getPeerConnectionCount(bob), "1");

    helpers.clearClientEvents(alice);
    helpers.clearClientEvents(bob);

    await helpers.clickNav(bob, "friends", "#page-content");
    await helpers.reloadClient(bob, 'nav [data-page="friends"]');
    await harness.delay(1500);
    await helpers.reloadClient(bob, 'nav [data-page="friends"]');
    await helpers.waitForPeerConnectionCount(alice, 1);
    await helpers.waitForPeerConnectionCount(bob, 1);

    const peerCountsAfterReload = {
      alice: await helpers.getPeerConnectionCount(alice),
      bob: await helpers.getPeerConnectionCount(bob),
    };
    const friendIconsAfterReload = {
      alice: await helpers.getFriendIconClass(alice),
      bob: await helpers.getFriendIconClass(bob),
    };
    const aliceErrors = helpers.getClientErrors(alice, NEGOTIATION_ERROR_PATTERN);
    const bobErrors = helpers.getClientErrors(bob, NEGOTIATION_ERROR_PATTERN);

    assert.equal(peerCountsAfterReload.alice, "1");
    assert.equal(peerCountsAfterReload.bob, "1");
    assert.equal(friendIconsAfterReload.alice, ONLINE_ICON_CLASS);
    assert.equal(friendIconsAfterReload.bob, ONLINE_ICON_CLASS);
    assert.equal(aliceErrors.length, 0);
    assert.equal(bobErrors.length, 0);

    return {
      peerCountsAfterReload,
      friendIconsAfterReload,
      aliceErrors,
      bobErrors,
      aliceTransportTail: helpers.getTransportLogs(alice).slice(-25),
      bobTransportTail: helpers.getTransportLogs(bob).slice(-25),
    };
  },
};
