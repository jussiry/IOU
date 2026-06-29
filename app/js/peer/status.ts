/*
This module stores peer connection status in two separate tiers:
  1. connectedPeerIds — friends with an open WebRTC data channel (fully online, green).
  2. serverPresentPeerIds — friends with at least one device registered on the relay
     server, tracked via peer_connect / peer_disconnect signals. A friend that is
     server-present but has no open WebRTC channel is "partly online" (yellow).

Keeping these tiers here lets page binders read online state without coupling the
persisted data model to transport details. Both data changes and peer status changes
trigger the same subscriber callbacks so the UI always reflects the latest state.
@category network
*/

export type PeerStatusListener = (connectedPeerIds: string[]) => void;
export type Unsubscribe = () => void;

const peerStatusListeners = new Set<PeerStatusListener>();
let connectedPeerIds = new Set<string>();
let connectedSelfDeviceIds = new Set<string>();

// userId → set of deviceIds currently registered on the relay server.
// A friend is "server present" when the set is non-empty.
const serverPresentDevices = new Map<string, Set<string>>();

const emitPeerStatusChange = (): void => {
  const snapshot = Array.from(connectedPeerIds);
  peerStatusListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // ignore listener failures so transport state remains resilient
    }
  });
};

const normalizePeerIds = (peerIds: unknown): string[] => {
  if (!Array.isArray(peerIds)) {
    return [];
  }

  return Array.from(
    new Set(
      peerIds
        .map((peerId) => (typeof peerId === "string" ? peerId.trim() : ""))
        .filter(Boolean)
    )
  );
};

export const getConnectedPeerIds = (): string[] => {
  return Array.from(connectedPeerIds);
};

export const replaceConnectedPeerIds = (peerIds: unknown): void => {
  const nextPeerIds = normalizePeerIds(peerIds);
  const nextConnectedPeerIds = new Set(nextPeerIds);
  const didChange =
    nextConnectedPeerIds.size !== connectedPeerIds.size ||
    nextPeerIds.some((peerId) => !connectedPeerIds.has(peerId));
  if (!didChange) {
    return;
  }

  connectedPeerIds = nextConnectedPeerIds;
  emitPeerStatusChange();
};

export const getConnectedSelfDeviceIds = (): string[] => {
  return Array.from(connectedSelfDeviceIds);
};

export const replaceConnectedSelfDeviceIds = (deviceIds: unknown): void => {
  const nextDeviceIds = normalizePeerIds(deviceIds);
  const nextConnectedSelfDeviceIds = new Set(nextDeviceIds);
  const didChange =
    nextConnectedSelfDeviceIds.size !== connectedSelfDeviceIds.size ||
    nextDeviceIds.some((deviceId) => !connectedSelfDeviceIds.has(deviceId));
  if (!didChange) {
    return;
  }

  connectedSelfDeviceIds = nextConnectedSelfDeviceIds;
  emitPeerStatusChange();
};

// Returns user IDs of friends who have at least one device on the relay server,
// regardless of whether a WebRTC data channel is open to them.
export const getServerPresentPeerIds = (): string[] => {
  const result: string[] = [];
  serverPresentDevices.forEach((devices, userId) => {
    if (devices.size > 0) result.push(userId);
  });
  return result;
};

// Called when a peer_connect signal arrives from the server for a friend device.
export const addServerPresentPeer = (userId: string, deviceId: string): void => {
  const uid = userId.trim();
  const did = deviceId.trim();
  if (!uid) return;

  let devices = serverPresentDevices.get(uid);
  const wasPresent = devices && devices.size > 0;
  if (!devices) {
    devices = new Set();
    serverPresentDevices.set(uid, devices);
  }
  devices.add(did || "__unknown__");
  const isPresent = devices.size > 0;
  if (wasPresent !== isPresent) {
    emitPeerStatusChange();
  }
};

// Called when a peer_disconnect signal arrives from the server for a friend device.
export const removeServerPresentPeer = (userId: string, deviceId: string): void => {
  const uid = userId.trim();
  const did = deviceId.trim();
  if (!uid) return;

  const devices = serverPresentDevices.get(uid);
  if (!devices) return;

  const wasPresent = devices.size > 0;
  devices.delete(did || "__unknown__");
  const isPresent = devices.size > 0;
  if (wasPresent !== isPresent) {
    emitPeerStatusChange();
  }
};

// Clears all server-presence records (called on user destroy / session reset).
export const clearServerPresentPeers = (): void => {
  if (serverPresentDevices.size === 0) return;
  serverPresentDevices.clear();
  emitPeerStatusChange();
};

export const subscribeToPeerStatusChanges = (
  listener: PeerStatusListener
): Unsubscribe => {
  if (typeof listener !== "function") {
    return () => {};
  }

  peerStatusListeners.add(listener);
  return () => {
    peerStatusListeners.delete(listener);
  };
};
