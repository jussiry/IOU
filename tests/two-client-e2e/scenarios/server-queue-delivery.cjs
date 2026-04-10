/*
This scenario validates that peer messages are delivered through the server's
envelope queue when the recipient is offline.

It creates two users, reads bob's key, takes bob offline, then has alice send
a friend request. Because no WebRTC connection exists, the message must travel
through the server queue. After bob comes back online, the scenario verifies
the queued envelope was delivered and the friend request appears.
*/

module.exports = {
  name: "server-queue-delivery",
  run: async ({ assert, createClient, helpers, harness }) => {
    const alice = await createClient({
      label: "alice",
      userName: "Alice",
    });
    const bob = await createClient({
      label: "bob",
      userName: "Bob",
    });

    // Read bob's key while online, then take bob offline
    const bobKey = await helpers.readMyKey(bob);
    await bob.page.close();
    await harness.delay(2000);

    helpers.clearClientEvents(alice);

    // Alice sends friend request while bob is offline
    await helpers.submitFriendRequest(alice, bobKey);
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
      queuedOnServer,
      sentDirectly,
      serverDelivered,
      bobFriendText,
      aliceTransportTail: aliceLogsAfterSend.slice(-10),
      bobTransportTail: bobLogs.slice(-10),
    };
  },
};
