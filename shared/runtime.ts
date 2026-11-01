export interface RuntimeHealth {
  host: string;
  workers: string[];
  updatedAt: { toMillis(): number } | null;
  executionReady: boolean;
}

// A stopped VM cannot publish an offline event. Expire its last heartbeat in the UI.
export function runtimeOnline(health: RuntimeHealth | null, now = Date.now()) {
  const timestamp = health?.updatedAt?.toMillis();
  return timestamp !== undefined && timestamp > now - 90000 && timestamp <= now + 10000;
}
