export function formatGreeting(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? `Hello, ${trimmed}!` : 'Hello!';
}
