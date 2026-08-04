"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  chooseDevelopmentRole,
  isCognitoConfigured,
  isDevelopmentAuthEnabled,
  restoreAuthenticatedUser,
  signOutCognito,
  startCognitoSignIn,
  type AuthenticatedUser,
} from "@/lib/cognitoAuth";
import type { AppRole } from "@/lib/authRole";

type AuthState = {
  status: "loading" | "authenticated" | "anonymous";
  user: AuthenticatedUser | null;
  cognitoConfigured: boolean;
  developmentLoginEnabled: boolean;
  refresh(): Promise<AuthenticatedUser | null>;
  signIn(returnTo?: string): Promise<void>;
  useDevelopmentRole(role: AppRole): Promise<void>;
  signOut(): void;
};

const AuthContext = createContext<AuthState | null>(null);

export function roleHome(role: AppRole) {
  if (role === "paramedic") return "/paramedic";
  return "/hospital";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  const refresh = useCallback(async () => {
    const restored = await restoreAuthenticatedUser();
    setUser(restored);
    setStatus(restored ? "authenticated" : "anonymous");
    return restored;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const value = useMemo<AuthState>(() => ({
    status,
    user,
    cognitoConfigured: isCognitoConfigured(),
    developmentLoginEnabled: isDevelopmentAuthEnabled(),
    refresh,
    signIn: (returnTo = "/") => startCognitoSignIn(returnTo),
    useDevelopmentRole: async (role) => {
      chooseDevelopmentRole(role);
      await refresh();
      window.location.assign(roleHome(role));
    },
    signOut: signOutCognito,
  }), [refresh, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
