// shared.js — Common utilities for all Gitstar webviews
// NOTE: This file must be loaded BEFORE page-specific JS
const vscode = acquireVsCodeApi();

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function formatCount(n) {
  if (!n && n !== 0) return "0";
  n = Number(n);
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return mins + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h";
  const days = Math.floor(hours / 24);
  if (days < 30) return days + "d";
  return new Date(dateStr).toLocaleDateString();
}

function doAction(type, payload) {
  vscode.postMessage({ type, payload: payload || {} });
}

function avatarUrl(login, size) {
  size = size || 72;
  return "https://github.com/" + encodeURIComponent(login) + ".png?size=" + size;
}
