import { useRef, useEffect, useCallback, useState } from "react";

interface QueuedAction {
  id: string;
  type: string;
  payload: any;
  timestamp: number;
}

const QUEUE_KEY = "lt_offline_queue";

function loadQueue(): QueuedAction[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedAction[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-50))); // max 50 items
  } catch {}
}

export function useOfflineQueue(
  send: (data: object) => boolean,
  isConnected: () => boolean
) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const queueRef = useRef<QueuedAction[]>(loadQueue());
  const flushingRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const flushQueue = useCallback(() => {
    if (flushingRef.current || !isConnected()) return;
    const queue = [...queueRef.current];
    if (queue.length === 0) return;

    flushingRef.current = true;
    const remaining: QueuedAction[] = [];

    for (const action of queue) {
      const sent = send({ type: action.type, payload: action.payload });
      if (!sent) {
        remaining.push(action);
      }
    }

    queueRef.current = remaining;
    saveQueue(remaining);
    flushingRef.current = false;
  }, [send, isConnected]);

  // Flush when coming back online
  useEffect(() => {
    if (isOnline) {
      setTimeout(flushQueue, 500); // small delay to let WS reconnect
    }
  }, [isOnline, flushQueue]);

  const enqueue = useCallback(
    (type: string, payload: any) => {
      const action: QueuedAction = {
        id: Math.random().toString(36).substr(2, 9),
        type,
        payload,
        timestamp: Date.now(),
      };

      // Try to send immediately
      if (isConnected()) {
        const sent = send({ type, payload });
        if (sent) return;
      }

      // Queue for later
      queueRef.current = [...queueRef.current, action];
      saveQueue(queueRef.current);
    },
    [send, isConnected]
  );

  return {
    enqueue,
    flushQueue,
    isOnline,
    pendingCount: queueRef.current.length,
  };
}