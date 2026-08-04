"use client";

import { useEffect, type ReactNode } from "react";
import type { AppRole } from "@/lib/authRole";
import { useAuth } from "./AuthProvider";
import AuthBrand from "./AuthBrand";
import styles from "./Auth.module.css";

export default function RoleGate({ allow, children }: { allow: readonly AppRole[]; children: ReactNode }) {
  const auth = useAuth();
  const permitted = auth.user?.roles.some((role) => allow.includes(role)) ?? false;
  useEffect(() => {
    if (auth.status === "anonymous") window.location.replace(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
  }, [auth.status]);

  if (auth.status === "loading" || auth.status === "anonymous") return <main className={styles.page}><section className={styles.card}><AuthBrand /><div className={styles.status}>업무 권한을 확인하고 있습니다.</div></section></main>;
  if (!permitted) return (
    <main className={styles.page}><section className={styles.card}><AuthBrand /><h1>접근 권한이 없습니다</h1><p>현재 계정에는 이 화면을 사용할 권한이 없습니다.</p><button className={styles.linkButton} onClick={auth.signOut}>다시 로그인</button></section></main>
  );
  return children;
}
