export function agoText(iso, now = Date.now()) {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function dirLabel(directory) {
  if (!directory) return "";
  const parts = String(directory).split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : parts.join("/");
}

export function sessionsSignature(sessions, now = Date.now()) {
  return sessions
    .map((session) => `${session.id}:${session.updatedAt}:${session.cost}:${agoText(session.updatedAt, now)}`)
    .join("|");
}
