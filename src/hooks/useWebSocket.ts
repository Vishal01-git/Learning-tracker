import { useRef, useEffect, useCallback } from "react";

type MessageHandler = (message: any) => void;

const INITIAL_DELAY = 1000;
const MAX_DELAY = 30000;
const BACKOFF_FACTOR = 1.5;

export function useWebSocket(
  token: string | null,
  roomId: string,
  userId: string | null,
  onMessage: MessageHandler,
  enabled: boolean = true
) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(INITIAL_DELAY);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const connect = useCallback(() => {
    if (!token || !userId || !enabled || !mountedRef.current) return;

    // Clean up existing socket
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.close();
      socketRef.current = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    socketRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectDelay.current = INITIAL_DELAY; // reset on successful connect
      ws.send(JSON.stringify({ type: "join", token, roomId }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const message = JSON.parse(event.data);
        onMessageRef.current(message);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      socketRef.current = null;

      // Don't reconnect on auth failure (code 1008) or intentional close (1000)
      if (event.code === 1000 || event.code === 1008) return;

      const delay = Math.min(reconnectDelay.current, MAX_DELAY);
      reconnectDelay.current = Math.min(delay * BACKOFF_FACTOR, MAX_DELAY);

      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after onerror, which handles reconnect
    };
  }, [token, roomId, userId, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.close(1000);
        socketRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((data: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  const isConnected = useCallback(() => {
    return socketRef.current?.readyState === WebSocket.OPEN;
  }, []);

  return { send, isConnected, reconnect: connect };
}