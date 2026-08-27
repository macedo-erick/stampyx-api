const WEEKLY_TARGETS = [20, 50, 100, 200, 400] as const;

export const UNLIMITED = null;

export function dailyCapFor(daysSinceFirstVerified: number): number | null {
  if (daysSinceFirstVerified < 0) {
    return WEEKLY_TARGETS[0];
  }

  const week = Math.floor(daysSinceFirstVerified / 7);

  return WEEKLY_TARGETS[week] ?? UNLIMITED;
}

export function warmupDay(daysSinceFirstVerified: number): number {
  return Math.max(daysSinceFirstVerified, 0) + 1;
}
