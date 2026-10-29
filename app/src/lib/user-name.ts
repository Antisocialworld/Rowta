// Pure helper to format and extract the user's display name for screens (D2).
// S1/A6/A8: Name only, never email or identifier.

export function formatSignedInUserName(user?: { displayName?: string } | null): string | null {
  if (!user || !user.displayName) return null;
  const trimmed = user.displayName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

