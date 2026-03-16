import { useEffect, useRef } from "react";
import { hasGoogleWorkspaceConnection, syncGoogleWorkspace } from "@/lib/googleSync";

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

export function GoogleSyncController() {
  const runningRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function runSync() {
      if (runningRef.current) return;
      runningRef.current = true;

      try {
        const connected = await hasGoogleWorkspaceConnection();
        if (mounted && connected) {
          await syncGoogleWorkspace();
        }
      } catch {
      } finally {
        runningRef.current = false;
      }
    }

    void runSync();

    const intervalId = window.setInterval(() => {
      void runSync();
    }, AUTO_SYNC_INTERVAL_MS);

    const handleFocus = () => {
      void runSync();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  return null;
}
