/*
This module provides a tiny markdown-like formatter for UI copy that needs lightweight emphasis without bringing in a full markdown parser.

It keeps rendering safe by escaping HTML first and then applying only the supported formatting rules. That makes it suitable for reuse in places like logs where text may come from user-controlled input.
*/

const escapeHtml = (value) => {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

export const formatMarkdownish = (value) => {
  const escapedValue = escapeHtml(value ?? "");
  return escapedValue.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
};
