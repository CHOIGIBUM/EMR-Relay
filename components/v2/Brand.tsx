"use client";

import Image from "next/image";
import { LogOut, RotateCcw } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import styles from "./V2.module.css";

export default function Brand({ subtitle, mobile = false, onHome, onDemoReset, resetPending = false }: {
  subtitle: string;
  mobile?: boolean;
  onHome?: () => void;
  onDemoReset?: () => void;
  resetPending?: boolean;
}) {
  const auth = useAuth();
  return (
    <header className={mobile ? styles.mobileHeader : styles.desktopHeader}>
      <button type="button" className={styles.brand} onClick={onHome} aria-label="업무 첫 화면으로 이동">
        <Image src="/ems-relay-icon.png" alt="" width={mobile ? 42 : 48} height={mobile ? 42 : 48} priority />
        <span><strong>EMS Relay</strong><small>{subtitle}</small></span>
      </button>
      <div className={styles.headerRight}>
        {onDemoReset ? <button type="button" className={styles.demoReset} disabled={resetPending} onClick={onDemoReset} aria-label="시연 데이터 초기화"><RotateCcw size={16} /><span>초기화</span></button> : null}
        <button type="button" className={styles.logout} onClick={auth.signOut} aria-label="로그아웃"><LogOut size={17} /><span>로그아웃</span></button>
      </div>
    </header>
  );
}
