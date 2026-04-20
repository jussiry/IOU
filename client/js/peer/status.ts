/*
This module stores the set of peer user IDs that currently have an open WebRTC data channel with the local client.

Keeping peer connection status in a tiny shared store lets page binders read online peer state without coupling the persisted data model to transport-only details. UI refreshes can subscribe to this store the same way they already react to local data changes.
*/

export type PeerStatusListener = (connectedPeerIds: string[]) => void;
export type Unsubscribe = () => void;

const peerStatusListeners = new Set<PeerStatusListener>();
let connectedPeerIds = new Set<string>();
let connectedSelfDeviceIds = new Set<string>();

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
