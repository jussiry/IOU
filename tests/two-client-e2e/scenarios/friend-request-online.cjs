/*
This scenario validates the friend-request handshake and the online-state indicators between two clients. It creates two users, sends a friend request, checks the pending-state connection indicators, accepts the request, and then verifies the accepted-state indicators stay online.

It acts as both an example scenario for the reusable two-client harness and a regression test for the WebRTC presence issues we just debugged. Future scenarios can follow the same shape while focusing on different multi-client behaviors.
*/

const ONLINE_ICON_CLASS = "friend-icon friend-icon--online";

const summarizeTransportLogs = (entries) => {
  const relevantEntries = entries.filter((entry) => {
    return /(Requesting peer connection|Requesting peer connection for queued data|Peer connection established|Peer connection disconnected)/.test(
      entry.text
    );
  });

  return {
    requesting: relevantEntries.filter((entry) =>
      entry.text.includes("Requesting peer connection")
    ).length,
    requestingQueued: relevantEntries.filter((entry) =>
      entry.text.includes("Requesting peer connection for queued data")
    ).length,
    established: relevantEntries.filter((entry) =>
      entry.text.includes("Peer connection established")
    ).length,
    disconnected: relevantEntries.filter((entry) =>
      entry.text.includes("Peer connection disconnected")
    ).length,
  };
};

module.exports = {
  name: "friend-request-online",
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
    await harness.delay(3000);

    const bobPendingRow = await helpers.getFriendRowText(bob);
    const pendingCounts = {
      alice: await helpers.getPeerConnectionCount(alice),
      bob: await helpers.getPeerConnectionCount(bob),
    };
    const pendingIcons = {
      alice: await helpers.getFriendIconClass(alice),
      bob: await helpers.getFriendIconClass(bob),
    };

    assert.match(bobPendingRow, /incoming/i);
    assert.equal(pendingCounts.alice, "1");
    assert.equal(pendingCounts.bob, "1");
    assert.equal(pendingIcons.alice, ONLINE_ICON_CLASS);
    assert.equal(pendingIcons.bob, ONLINE_ICON_CLASS);

    await helpers.acceptFirstFriend(bob);
    await harness.delay(3000);

    const acceptedCounts = {
      alice: await helpers.getPeerConnectionCount(alice),
      bob: await helpers.getPeerConnectionCount(bob),
    };
    const acceptedIcons = {
      alice: await helpers.getFriendIconClass(alice),
      bob: await helpers.getFriendIconClass(bob),
    };

    assert.equal(acceptedCounts.alice, "1");
    assert.equal(acceptedCounts.bob, "1");
    assert.equal(acceptedIcons.alice, ONLINE_ICON_CLASS);
    assert.equal(acceptedIcons.bob, ONLINE_ICON_CLASS);

    const aliceTransport = summarizeTransportLogs(
      helpers.getTransportLogs(alice)
    );
    assert.equal(aliceTransport.requesting, 1);
    assert.equal(aliceTransport.requestingQueued, 0);

    return {
      pendingCounts,
      pendingIcons,
      acceptedCounts,
      acceptedIcons,
      aliceTransport,
      bobTransport: summarizeTransportLogs(helpers.getTransportLogs(bob)),
    };
  },
};
