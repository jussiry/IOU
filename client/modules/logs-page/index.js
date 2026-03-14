/*
This module binds the logs page and maps log entries into reusable template nodes. It handles timestamp formatting and optional message suffixes per entry.

Keeping log-row assembly isolated here allows the data layer to stay transport-focused while this module owns presentation details.
*/

import { formatMarkdownish } from "../../js/utils/markdownish.js";

export const bindLogs = (root, data) => {
  const listEl = root.querySelector('[data-list="logs"]');
  const itemTemplate = root.querySelector('[data-template="log-item"]');
  if (!listEl || !itemTemplate) return;

  listEl.innerHTML = "";
  const logs = Array.isArray(data.logs) ? data.logs : [];

  logs.forEach((log) => {
    const node = itemTemplate.content.firstElementChild.cloneNode(true);
    const timeEl = node.querySelector('[data-bind="time"]');
    const textEl = node.querySelector('[data-bind="text"]');
    if (timeEl) {
      const time = new Date(log.timestamp);
      timeEl.textContent = Number.isNaN(time.getTime())
        ? ""
        : time.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
    }
    if (textEl) {
      const message = log.message ? log.message.trim() : "";
      const messageSuffix = message ? ` — ${message}` : "";
      textEl.innerHTML = formatMarkdownish(`${log.text || ""}${messageSuffix}`);
    }
    listEl.appendChild(node);
  });
};
