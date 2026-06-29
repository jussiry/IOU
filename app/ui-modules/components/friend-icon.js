/*
Shared friend-icon component. Renders a coloured person SVG icon that reflects
a peer's presence state: green for a live WebRTC connection, yellow (notify) for
a relay/server presence, and muted grey when offline.

Two helpers are exported so the same display logic can be reused in both the
friends-list rows and the friend detail page header without duplicating state
derivation or class manipulation.
@category ui
*/

/**
 * Creates a new SVG element using the #icon-person sprite symbol.
 * Apply setFriendIconStatus() to colour it after creation.
 */
export const createFriendIcon = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("friend-icon");

  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#icon-person");
  svg.appendChild(use);

  return svg;
};

/**
 * Applies the correct colour class to a .friend-icon element based on
 * the peer's presence state.
 * @param {Element} el  - the .friend-icon SVG element
 * @param {boolean} isOnline  - true when a live WebRTC peer connection exists
 * @param {boolean} isRelay   - true when reachable only via server relay
 */
export const setFriendIconStatus = (el, isOnline, isRelay) => {
  if (!el) return;
  el.classList.toggle("friend-icon--online", Boolean(isOnline));
  el.classList.toggle("friend-icon--relay", Boolean(isRelay));
};
