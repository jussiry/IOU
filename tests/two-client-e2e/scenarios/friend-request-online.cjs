/*
This scenario validates the friend-request handshake and the online-state indicators between two clients. It creates two users, sends a friend request, checks the pending-state connection indicators, accepts the request, and then verifies the accepted-state indicators stay online.

It acts as both an example scenario for the reusable two-client harness and a regression test for the WebRTC presence issues we just debugged. Future scenarios can follow the same shape while focusing on different multi-client behaviors.

Uses pre-seeded solo fixtures (no prior connections) so the welcome form is
skipped. Bob's known public key is used directly instead of readMyKey.
*/

const { BOB, buildSoloFixtures } = require("../fixtures/paired-friends.cjs");

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
  run: async ({ assert, createSeededClient, helpers, harness }) => {
    const setupStart = Date.now();
    const fixtures = buildSoloFixtures();
    const alice = await createSeededClient({ label: "alice", seed: fixtures.alice });
    const bob = await createSeededClient({ label: "bob", seed: fixtures.bob });

    // Bob's public key is known from the fixture — no readMyKey round-trip needed
    await helpers.submitFriendRequest(alice, BOB.publicKeyNpub);
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
      setupMs: Date.now() - setupStart,
      pendingCounts,
      pendingIcons,
      acceptedCounts,
      acceptedIcons,
      aliceTransport,
      bobTransport: summarizeTransportLogs(helpers.getTransportLogs(bob)),
    };
  },
};
