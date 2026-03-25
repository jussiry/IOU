/*
This scenario validates that a browser reload can re-establish the peer connection without negotiation exceptions. It creates two users, establishes an accepted friendship, reloads one client, and then inspects both the UI connection indicators and the captured browser errors after reconnect.

The goal is to catch reload-specific WebRTC negotiation bugs such as offer-collision state errors and ICE-restart mismatches. Keeping it as a separate scenario makes it easy to rerun the same reconnect check across Chromium and Firefox from the same harness command.
*/

const NEGOTIATION_ERROR_PATTERN =
  /have-remote-offer|setLocalDescription|ICE restart|ice-ufrag|ice-pwd|Cannot set local offer/i;

const ONLINE_ICON_CLASS = "friend-icon friend-icon--online";

module.exports = {
  name: "reload-reconnect",
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
      aliceTransportTail: helpers.getTransportLogs(alice).slice(-20),
      bobTransportTail: helpers.getTransportLogs(bob).slice(-20),
    };
  },
};
