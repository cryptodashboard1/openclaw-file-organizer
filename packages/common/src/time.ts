export function nowIso(): string {
  return new Date().toISOString();
}

export function minutesFromNowIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

