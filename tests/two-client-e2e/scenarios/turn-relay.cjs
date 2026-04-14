/*
This scenario validates that two peers can connect and exchange a friend
request when direct ICE candidates are disabled, forcing the connection
through the TURN relay server.

Both clients are created with an init script that overrides RTCPeerConnection
to set iceTransportPolicy to "relay". This means only TURN relay candidates
are gathered — no host or srflx candidates — so the connection can only
succeed if the TURN server is reachable and working.

NOTE: Requires the TURN server at junction.proxy.rlwy.net:20947 to be online.
*/

const { BOB, buildSoloFixtures } = require("../fixtures/paired-friends.cjs");

const ONLINE_ICON_CLASS = "friend-icon friend-icon--online";

const FORCE_RELAY_SCRIPT = () => {
  const OrigRTC = window.RTCPeerConnection;
  window.RTCPeerConnection = new Proxy(OrigRTC, {
    construct(target, args) {
      const config = Object.assign({}, args[0] || {}, {
        iceTransportPolicy: "relay",
      });
      return new target(config, args[1]);
    },
  });
};

module.exports = {
  name: "turn-relay",
  run: async ({ assert, createSeededClient, helpers, harness }) => {
    const setupStart = Date.now();
    const fixtures = buildSoloFixtures();
    const alice = await createSeededClient({
      label: "alice",
      seed: fixtures.alice,
      initScripts: [FORCE_RELAY_SCRIPT],
    });
    const bob = await createSeededClient({
      label: "bob",
      seed: fixtures.bob,
      initScripts: [FORCE_RELAY_SCRIPT],
    });

    await helpers.submitFriendRequest(alice, BOB.publicKeyNpub);
    await helpers.waitForFriendRows(bob, 1);
    await harness.delay(3000);

    // Verify peer connections are established through TURN relay
    const peerCounts = {
      alice: await helpers.getPeerConnectionCount(alice),
      bob: await helpers.getPeerConnectionCount(bob),
    };
    const friendIcons = {
      alice: await helpers.getFriendIconClass(alice),
      bob: await helpers.getFriendIconClass(bob),
    };

    assert.equal(peerCounts.alice, "1", "Alice should have 1 peer connection");
    assert.equal(peerCounts.bob, "1", "Bob should have 1 peer connection");
    assert.equal(friendIcons.alice, ONLINE_ICON_CLASS, "Alice should see Bob online");
    assert.equal(friendIcons.bob, ONLINE_ICON_CLASS, "Bob should see Alice online");

    // Verify ICE candidates are relay type (not host or srflx)
    const aliceCandidateLogs = helpers
      .getTransportLogs(alice)
      .filter((entry) => entry.text.includes("ICE candidate"));
    const bobCandidateLogs = helpers
      .getTransportLogs(bob)
      .filter((entry) => entry.text.includes("ICE candidate"));

    const hasHostCandidate = (logs) =>
      logs.some((entry) => /typ host/.test(entry.text));
    const hasRelayCandidate = (logs) =>
      logs.some((entry) => /typ relay/.test(entry.text));

    assert.equal(
      hasHostCandidate(aliceCandidateLogs),
      false,
      "Alice should not have host candidates"
    );
    assert.equal(
      hasHostCandidate(bobCandidateLogs),
      false,
      "Bob should not have host candidates"
    );
    assert.equal(
      hasRelayCandidate(aliceCandidateLogs) || hasRelayCandidate(bobCandidateLogs),
      true,
      "At least one side should have relay candidates"
    );

    // Accept the friend request to confirm data channel works through TURN
    await helpers.acceptFirstFriend(bob);
    await harness.delay(3000);

    const acceptedCounts = {
      alice: await helpers.getPeerConnectionCount(alice),
      bob: await helpers.getPeerConnectionCount(bob),
    };

    assert.equal(acceptedCounts.alice, "1", "Alice should still have 1 peer after accept");
    assert.equal(acceptedCounts.bob, "1", "Bob should still have 1 peer after accept");

    const errors = {
      alice: helpers.getClientErrors(alice),
      bob: helpers.getClientErrors(bob),
    };

    assert.equal(errors.alice.length, 0, "Alice should have no errors");
    assert.equal(errors.bob.length, 0, "Bob should have no errors");

    return {
      setupMs: Date.now() - setupStart,
      peerCounts,
      friendIcons,
      acceptedCounts,
      aliceCandidates: aliceCandidateLogs.length,
      bobCandidates: bobCandidateLogs.length,
      hasHostCandidate: hasHostCandidate(aliceCandidateLogs) || hasHostCandidate(bobCandidateLogs),
      errors,
    };
  },
};
