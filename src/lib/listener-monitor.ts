/**
 * Development-only listener monitoring to detect infinite loops
 * This helps catch runaway document listeners before they cause production issues
 */

interface ListenerEntry {
  count: number;
  timestamps: number[];
}

const listenerRegistry = new Map<string, ListenerEntry>();

/**
 * Track document listener lifecycle events
 * @param componentName - Name of the component/hook creating the listener
 * @param action - Whether the listener is being created or cleaned up
 */
export function trackListener(
  componentName: string,
  action: "create" | "cleanup"
) {
  // Only run in development mode
  if (process.env.NODE_ENV !== "development") return;

  const key = componentName;
  const entry = listenerRegistry.get(key) || { count: 0, timestamps: [] };

  if (action === "create") {
    entry.count++;
    entry.timestamps.push(Date.now());

    // Check for rapid re-creation (more than 3 times in 10 seconds)
    const recentTimestamps = entry.timestamps.filter(
      (t) => Date.now() - t < 10000
    );

    if (recentTimestamps.length > 3) {
      console.warn(
        `⚠️ [INFINITE LOOP DETECTED] ${componentName}:\n` +
          `  Listener created ${recentTimestamps.length} times in 10 seconds.\n` +
          `  This indicates a potential infinite loop in your useEffect dependencies.\n` +
          `  Check the dependency array and ensure callbacks are properly memoized.`
      );
    }

    // Keep only recent timestamps to prevent memory leak
    entry.timestamps = recentTimestamps;
  } else if (action === "cleanup") {
    entry.count = Math.max(0, entry.count - 1);
  }

  listenerRegistry.set(key, entry);
}

/**
 * Get current listener statistics (for debugging)
 */
export function getListenerStats() {
  if (process.env.NODE_ENV !== "development") return {};

  const stats: Record<string, { activeCount: number; totalCreations: number }> =
    {};

  listenerRegistry.forEach((entry, key) => {
    stats[key] = {
      activeCount: entry.count,
      totalCreations: entry.timestamps.length,
    };
  });

  return stats;
}

/**
 * Clear all listener tracking (useful for testing)
 */
export function clearListenerTracking() {
  if (process.env.NODE_ENV !== "development") return;
  listenerRegistry.clear();
}
