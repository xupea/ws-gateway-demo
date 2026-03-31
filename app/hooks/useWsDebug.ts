'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'initialized'
  | 'error';

export interface LogEntry {
  id: number;
  time: string;
  direction: 'in' | 'out' | 'system';
  content: string;
}

export interface Subscription {
  id: string;   // client-generated UUID
  topic: string;
}

let logId = 0;

function makeLog(direction: LogEntry['direction'], content: string): LogEntry {
  return {
    id: ++logId,
    time: new Date().toLocaleTimeString(),
    direction,
    content,
  };
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface ConnectOptions {
  wsUrl: string;
  accessToken: string;
  language?: string;
  lockdownToken?: string;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 10_000;

export function useWsDebug() {
  const [status, setStatus]               = useState<ConnectionStatus>('disconnected');
  const [logs, setLogs]                   = useState<LogEntry[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const wsRef                             = useRef<WebSocket | null>(null);
  const connectOptionsRef                 = useRef<ConnectOptions | null>(null);
  const manualDisconnectRef               = useRef(false);
  const heartbeatTimerRef                 = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef               = useRef(0);
  const desiredSubscriptionsRef           = useRef<Subscription[]>([]);

  const addLog = useCallback((direction: LogEntry['direction'], content: string) => {
    setLogs((prev) => [...prev.slice(-199), makeLog(direction, content)]);
  }, []);

  /** 内部：直接发送原始字符串并记日志 */
  const sendRaw = useCallback((ws: WebSocket, payload: string) => {
    ws.send(payload);
    try {
      addLog('out', JSON.stringify(JSON.parse(payload), null, 2));
    } catch {
      addLog('out', payload);
    }
  }, [addLog]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const stopReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (manualDisconnectRef.current || !connectOptionsRef.current) return;
    stopReconnect();

    reconnectAttemptRef.current += 1;
    setReconnectAttempt(reconnectAttemptRef.current);

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (reconnectAttemptRef.current - 1),
      RECONNECT_MAX_DELAY_MS,
    );

    setStatus('reconnecting');
    addLog('system', `Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current}) ...`);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      const opts = connectOptionsRef.current;
      if (opts) {
        openConnection(opts, true);
      }
    }, delay);
  }, [addLog, stopReconnect]);

  const startHeartbeat = useCallback((ws: WebSocket) => {
    stopHeartbeat();
    heartbeatTimerRef.current = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      sendRaw(ws, JSON.stringify({ type: 'ping' }));
    }, HEARTBEAT_INTERVAL_MS);
  }, [sendRaw, stopHeartbeat]);

  const openConnection = useCallback((opts: ConnectOptions, isReconnect = false) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    stopReconnect();
    stopHeartbeat();

    setStatus(isReconnect ? 'reconnecting' : 'connecting');
    addLog('system', `${isReconnect ? 'Reconnecting' : 'Connecting'} to ${opts.wsUrl} ...`);

    const ws = new WebSocket(opts.wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
      setStatus('connected');
      addLog('system', 'WebSocket opened — sending connection_init ...');

      // 自动发送 connection_init
      const initMsg = JSON.stringify({
        type: 'connection_init',
        payload: {
          accessToken:   opts.accessToken,
          language:      opts.language || 'en',
          lockdownToken: opts.lockdownToken || '',
        },
      });
      sendRaw(ws, initMsg);
    };

    ws.onmessage = (e) => {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(e.data);
        addLog('in', JSON.stringify(parsed, null, 2));
      } catch {
        addLog('in', e.data);
        return;
      }

      if (!parsed) return;

      // 收到 connection_ack → 状态变为 initialized
      if (parsed.type === 'connection_ack') {
        setStatus('initialized');
        addLog('system', 'Connection acknowledged — ready');
        startHeartbeat(ws);

        const desiredSubscriptions = desiredSubscriptionsRef.current;
        if (desiredSubscriptions.length > 0) {
          for (const subscription of desiredSubscriptions) {
            const msg = JSON.stringify({ id: subscription.id, type: 'subscribe', payload: subscription.topic });
            sendRaw(ws, msg);
          }
          setSubscriptions(desiredSubscriptions);
          addLog('system', `Restored ${desiredSubscriptions.length} subscription(s)`);
        }
        return;
      }

      if (parsed.type === 'pong') {
        addLog('system', 'Heartbeat acknowledged');
      }
    };

    ws.onerror = () => {
      setStatus('error');
      addLog('system', 'Connection error');
    };

    ws.onclose = (e) => {
      stopHeartbeat();
      setStatus('disconnected');
      addLog('system', `Disconnected (code: ${e.code})`);
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      if (!manualDisconnectRef.current) {
        scheduleReconnect();
      }
    };
  }, [addLog, scheduleReconnect, sendRaw, startHeartbeat, stopHeartbeat, stopReconnect]);

  const connect = useCallback((opts: ConnectOptions) => {
    manualDisconnectRef.current = false;
    connectOptionsRef.current = opts;
    openConnection(opts);
  }, [openConnection]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    stopReconnect();
    stopHeartbeat();
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('disconnected');
    addLog('system', 'Disconnected by user');
  }, [addLog, stopHeartbeat, stopReconnect]);

  const sendMessage = useCallback((payload: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('system', 'Not connected');
      return;
    }
    sendRaw(wsRef.current, payload);
  }, []);

  /** 订阅指定 topic，返回订阅 id */
  const subscribe = useCallback((topic: string): string => {
    if (status !== 'initialized' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('system', 'Connection not ready');
      return '';
    }
    const id = generateId();
    const msg = JSON.stringify({ id, type: 'subscribe', payload: topic });
    sendRaw(wsRef.current, msg);
    const next = [...desiredSubscriptionsRef.current, { id, topic }];
    desiredSubscriptionsRef.current = next;
    setSubscriptions(next);
    return id;
  }, [addLog, sendRaw, status]);

  /** 取消订阅（发送 complete） */
  const unsubscribe = useCallback((id: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg = JSON.stringify({ id, type: 'complete' });
      sendRaw(wsRef.current, msg);
    }
    const next = desiredSubscriptionsRef.current.filter((s) => s.id !== id);
    desiredSubscriptionsRef.current = next;
    setSubscriptions(next);
  }, [addLog, sendRaw]);

  /** 发送 ping */
  const ping = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('system', 'Not connected');
      return;
    }
    sendRaw(wsRef.current, JSON.stringify({ type: 'ping' }));
  }, [addLog, sendRaw]);

  const clearLogs = useCallback(() => setLogs([]), []);

  useEffect(() => () => {
    manualDisconnectRef.current = true;
    stopReconnect();
    stopHeartbeat();
    wsRef.current?.close();
  }, [stopHeartbeat, stopReconnect]);

  return {
    status,
    logs,
    subscriptions,
    reconnectAttempt,
    connect,
    disconnect,
    sendMessage,
    subscribe,
    unsubscribe,
    ping,
    clearLogs,
  };
}
