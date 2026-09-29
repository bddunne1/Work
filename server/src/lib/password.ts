// Password policy shared by account creation, admin resets and self-service
// changes (R5-04). Deliberately simple: length is what matters against
// guessing, and the sign-in throttle handles the rest.
export const MIN_PASSWORD_LENGTH = 10;

const DENY = new Set([
  "password", "password1", "passw0rd", "1234567890", "qwertyuiop", "administrator",
  "aamstrand1", "aamstrand123", "changeme123", "letmein123",
]);

// Returns a user-facing reason the password is unacceptable, or null if it's fine.
export function passwordProblem(password: string, username?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "Password is too long.";
  const lower = password.toLowerCase();
  if (DENY.has(lower)) return "That password is too common - choose something else.";
  if (username && lower.includes(username.trim().toLowerCase()) && username.trim().length >= 3) {
    return "Password can't contain the username.";
  }
  if (/^(.)\1+$/.test(password)) return "Password can't be one repeated character.";
  return null;
}
