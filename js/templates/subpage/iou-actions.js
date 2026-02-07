export const initIouActions = (root, friendId) => {
  const sendButton = root.querySelector('[data-action="send"]');
  if (sendButton) {
    sendButton.addEventListener("click", () => {
      const target = friendId ? `send/${friendId}` : "send";
      window.location.hash = target;
    });
  }
};
