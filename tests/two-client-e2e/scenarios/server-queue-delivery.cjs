/*
This scenario validates that peer messages are delivered through the server's
envelope queue when the recipient is offline.

Creates two solo-seeded users (skipping the welcome flow), takes bob offline
immediately, then has alice send a friend request. Because no WebRTC connection
exists, the message must travel through the server queue. After bob comes back
online, the scenario verifies the queued envelope was delivered and the friend
request appears.
*/

const { BOB, buildSoloFixtures } = require("../fixtures/paired-friends.cjs");

module.exports = {
  name: "server-queue-delivery",
  run: async ({ assert, createSeededClient, helpers, harness }) => {
    const setupStart = Date.now();
    const fixtures = buildSoloFixtures();
    const alice = await createSeededClient({ label: "alice", seed: fixtures.alice });
    const bob = await createSeededClient({ label: "bob", seed: fixtures.bob });

    // Take bob offline — his key is already known from the fixture
    await bob.page.close();
    await harness.delay(2000);

    helpers.clearClientEvents(alice);

    // Alice sends friend request while bob is offline (key known from fixture)
    await helpers.submitFriendRequest(alice, BOB.publicKeyNpub);
    await harness.delay(2000);

    // Verify the message was queued on the server (not sent via WebRTC)
    const aliceLogsAfterSend = helpers.getTransportLogs(alice);
    const queuedOnServer = aliceLogsAfterSend.some((entry) =>
      entry.text.includes("Queued peer envelope on server")
    );
    const sentDirectly = aliceLogsAfterSend.some((entry) =>
      entry.text.includes("Peer data sent")
    );

    assert.equal(queuedOnServer, true, "Message should be queued on server");
    assert.equal(sentDirectly, false, "Message should not be sent via WebRTC");

    // Bring bob back online (same context preserves IndexedDB)
    helpers.clearClientEvents(bob);
    await helpers.reopenClient(bob);
    await harness.delay(3000);

    // Verify bob received the envelope from the server queue
    const bobLogs = helpers.getTransportLogs(bob);
    const serverDelivered = bobLogs.some((entry) =>
      entry.text.includes("Peer envelope received from server")
    );

    assert.equal(serverDelivered, true, "Bob should receive envelope from server");

    // Verify bob sees alice as a friend
    await helpers.waitForFriendRows(bob, 1);
    const bobFriendText = await helpers.getFriendRowText(bob);

    assert.match(bobFriendText, /Alice/i, "Bob should see Alice in friends list");

    return {
      setupMs: Date.now() - setupStart,
      queuedOnServer,
      sentDirectly,
      serverDelivered,
      bobFriendText,
      aliceTransportTail: aliceLogsAfterSend.slice(-10),
      bobTransportTail: bobLogs.slice(-10),
    };
  },
};
