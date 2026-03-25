/*
This scenario captures reload/reconnect state without asserting success. It is useful while tightening WebRTC renegotiation logic because it returns peer counts, icon state, transport tails, and matching browser errors after one client reloads.

Keeping this diagnostic scenario in the test folder makes it easy to compare browser behavior during debugging without having to fall back to ad hoc temporary scripts outside the reusable two-client harness.
*/

const NEGOTIATION_ERROR_PATTERN =
  /have-remote-offer|setLocalDescription|ICE restart|ice-ufrag|ice-pwd|Cannot set local offer/i;

module.exports = {
  name: "reload-reconnect-diagnostic",
  run: async ({ createClient, helpers, harness }) => {
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

    const countsBeforeReload = {
      alice: await helpers.getPeerConnectionCount(alice),
      bob: await helpers.getPeerConnectionCount(bob),
    };

    helpers.clearClientEvents(alice);
    helpers.clearClientEvents(bob);

    await helpers.clickNav(bob, "friends", "#page-content");
    await helpers.reloadClient(bob, 'nav [data-page="friends"]');
    await harness.delay(8000);

    return {
      countsBeforeReload,
      peerCountsAfterReload: {
        alice: await helpers.getPeerConnectionCount(alice),
        bob: await helpers.getPeerConnectionCount(bob),
      },
      friendIconsAfterReload: {
        alice: await helpers.getFriendIconClass(alice),
        bob: await helpers.getFriendIconClass(bob),
      },
      aliceErrors: helpers.getClientErrors(alice, NEGOTIATION_ERROR_PATTERN),
      bobErrors: helpers.getClientErrors(bob, NEGOTIATION_ERROR_PATTERN),
      aliceTransportTail: helpers.getTransportLogs(alice).slice(-30),
      bobTransportTail: helpers.getTransportLogs(bob).slice(-30),
    };
  },
};
