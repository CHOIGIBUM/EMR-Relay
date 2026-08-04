"use client";

import { useEffect } from "react";
import { useAuth, roleHome } from "./AuthProvider";
import type { AppRole } from "@/lib/authRole";
import AuthBrand from "./AuthBrand";
import styles from "./Auth.module.css";

const developmentRoles: Array<{ role: AppRole; label: string }> = [
  { role: "paramedic", label: "구급대원" },
  { role: "hospital", label: "병원" },
];

export default function LoginScreen() {
  const auth = useAuth();
  useEffect(() => {
    if (auth.status === "authenticated" && auth.user?.roles[0]) window.location.replace(roleHome(auth.user.roles[0]));
  }, [auth.status, auth.user]);

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <AuthBrand />
        <h1 id="login-title">업무 계정으로 로그인</h1>
        <p>소속과 역할에 맞는 화면으로 연결됩니다. 환자정보는 권한이 확인된 사용자에게만 표시됩니다.</p>
        {auth.status === "loading" ? (
          <div className={styles.status}>로그인 상태를 확인하고 있습니다.</div>
        ) : (
          <>
            <button className={styles.primary} disabled={!auth.cognitoConfigured} onClick={() => void auth.signIn(new URLSearchParams(window.location.search).get("returnTo") || "/") }>
              업무 계정으로 계속
            </button>
            {!auth.cognitoConfigured && <p className={styles.error}>로그인 환경이 아직 연결되지 않았습니다.</p>}
            {auth.developmentLoginEnabled && (
              <>
                <div className={styles.divider}>로컬 개발 화면</div>
                <div className={styles.roles}>
                  {developmentRoles.map(({ role, label }) => (
                    <button key={role} className={styles.roleButton} onClick={() => void auth.useDevelopmentRole(role)}>{label}</button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
