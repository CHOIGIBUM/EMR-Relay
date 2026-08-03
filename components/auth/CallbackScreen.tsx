"use client";

import { useEffect, useState } from "react";
import { completeCognitoSignIn } from "@/lib/cognitoAuth";
import styles from "./Auth.module.css";

export default function CallbackScreen() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    const state = new URLSearchParams(window.location.search).get("state");
    if (!code || !state) {
      const timer = window.setTimeout(() => setError("로그인 응답을 확인하지 못했습니다."), 0);
      return () => window.clearTimeout(timer);
    }
    void completeCognitoSignIn(code, state).then(({ returnTo }) => window.location.replace(returnTo)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "로그인을 완료하지 못했습니다."));
  }, []);
  return <main className={styles.page}><section className={styles.card}><div className={styles.status}>{error ?? "로그인을 완료하고 있습니다."}</div>{error && <button className={styles.linkButton} onClick={() => window.location.replace("/login")}>로그인으로 돌아가기</button>}</section></main>;
}
