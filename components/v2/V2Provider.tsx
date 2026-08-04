"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { getV2Api, type EmsV2Api } from "@/lib/v2/api";
import { createInitialV2Store } from "@/lib/v2/fixtures";
import type { V2RealtimeScope, V2RealtimeStatus, V2Role, V2Store } from "@/lib/v2/types";

type V2ContextValue = {
  api: EmsV2Api;
  store: V2Store | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
  realtimeStatus: V2RealtimeStatus;
  refresh(): Promise<void>;
  run<T>(operation: () => Promise<T>): Promise<T>;
};

const V2Context = createContext<V2ContextValue | null>(null);

export function V2Provider({ children, role, api: injectedApi }: { children: ReactNode; role: V2Role; api?: EmsV2Api }) {
  const auth = useAuth();
  const api = useMemo(() => injectedApi ?? getV2Api(), [injectedApi]);
  const [store, setStore] = useState<V2Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remote = process.env.NEXT_PUBLIC_EMS_DATA_MODE === "remote";
  const [realtimeStatus, setRealtimeStatus] = useState<V2RealtimeStatus>(remote ? "connecting" : "disconnected");

  const refresh = useCallback(async () => {
    try {
      if (role === "hospital" && remote) {
        const referenceStore = createInitialV2Store();
        referenceStore.cases = [];
        referenceStore.requests = [];
        referenceStore.hospitals = await api.listHospitals();
        referenceStore.updatedAt = new Date().toISOString();
        setStore(referenceStore);
      } else {
        setStore(await api.getStore());
      }
      setError(null);
    } catch (reason) {
      console.error("EMS Relay v2 refresh failed", reason);
      setError(reason instanceof Error ? reason.message : "업무 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [api, remote, role]);

  useEffect(() => {
    const unsubscribe = api.subscribe((nextStore) => {
      setStore(nextStore);
      setLoading(false);
      setError(null);
    });
    // Start the first read immediately. A zero-delay timer can be cancelled by
    // React's effect re-run before its callback executes, leaving the screen in
    // an endless loading state on the production build.
    void refresh(); // eslint-disable-line react-hooks/set-state-in-effect
    const onVisibilityChange = () => {
      if (!document.hidden) void refresh();
    };
    if (remote) document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (remote) document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribe();
    };
  }, [api, refresh, remote]);

  const caseIdsKey = useMemo(
    () => store?.cases.map((incident) => incident.id).sort().join("|") ?? "",
    [store?.cases],
  );
  const realtimeScope = useMemo<V2RealtimeScope | null>(() => {
    if (!remote) return null;
    if (role === "hospital") {
      const hospitalId = auth.user?.institutionId;
      return hospitalId ? { role, hospitalId } : null;
    }
    const caseIds = caseIdsKey.split("|").filter(Boolean);
    return caseIds.length ? { role, caseIds } : null;
  }, [auth.user?.institutionId, caseIdsKey, remote, role]);

  useEffect(() => {
    if (!realtimeScope) return;
    let refreshTimer: number | null = null;
    const queueRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 50);
    };
    const stop = api.watchUpdates(
      realtimeScope,
      queueRefresh,
      (status) => {
        setRealtimeStatus(status);
        // Close the small query-to-subscribe race by reading one authoritative
        // snapshot immediately after every successful (re)subscription.
        if (status === "connected") queueRefresh();
      },
    );
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      stop();
    };
  }, [api, realtimeScope, refresh]);

  // Poll only while the WebSocket is unavailable. This preserves the proven
  // two-second fallback without duplicating reads during a healthy subscription.
  useEffect(() => {
    if (!remote || realtimeStatus === "connected") return;
    const poll = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2_000);
    return () => window.clearInterval(poll);
  }, [realtimeStatus, refresh, remote]);

  const run = useCallback(async <T,>(operation: () => Promise<T>) => {
    setPending(true);
    setError(null);
    try {
      const result = await operation();
      await refresh();
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "업무를 반영하지 못했습니다.";
      setError(message);
      throw reason;
    } finally {
      setPending(false);
    }
  }, [refresh]);

  const value = useMemo<V2ContextValue>(
    () => ({ api, store, loading, pending, error, realtimeStatus, refresh, run }),
    [api, error, loading, pending, realtimeStatus, refresh, run, store],
  );
  return <V2Context.Provider value={value}>{children}</V2Context.Provider>;
}

export function useV2() {
  const context = useContext(V2Context);
  if (!context) throw new Error("useV2 must be used inside V2Provider");
  return context;
}
