"use client";

import Image from "next/image";
import { Building2, LogOut, RotateCcw } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import styles from "./V2.module.css";

type HospitalContext = {
  id: string;
  name: string;
  options?: readonly { id: string; name: string }[];
  onChange?: (hospitalId: string) => void;
  disabled?: boolean;
};

export default function Brand({ subtitle, mobile = false, onHome, onDemoReset, resetPending = false, hospitalContext }: {
  subtitle: string;
  mobile?: boolean;
  onHome?: () => void;
  onDemoReset?: () => void;
  resetPending?: boolean;
  hospitalContext?: HospitalContext;
}) {
  const auth = useAuth();
  const canSwitchHospital = Boolean(hospitalContext?.onChange && hospitalContext.options && hospitalContext.options.length > 1);
  return (
    <header className={mobile ? styles.mobileHeader : styles.desktopHeader}>
      <button type="button" className={styles.brand} onClick={onHome} aria-label="업무 첫 화면으로 이동">
        <Image src="/ems-relay-icon.png" alt="" width={mobile ? 42 : 48} height={mobile ? 42 : 48} priority />
        <span><strong>EMS Relay</strong><small>{subtitle}</small></span>
      </button>
      <div className={styles.headerRight}>
        {hospitalContext ? <div className={styles.hospitalAccount} aria-label={`현재 병원 ${hospitalContext.name}`}>
          <Building2 size={19} aria-hidden="true" />
          <span>
            <small>현재 병원</small>
            {canSwitchHospital ? <select
              aria-label="담당 병원 전환"
              value={hospitalContext.id}
              disabled={hospitalContext.disabled}
              onChange={(event) => hospitalContext.onChange?.(event.target.value)}
            >
              {hospitalContext.options?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select> : <strong title={hospitalContext.name}>{hospitalContext.name}</strong>}
          </span>
        </div> : null}
        {onDemoReset ? <button type="button" className={styles.demoReset} disabled={resetPending} onClick={onDemoReset} aria-label="시연 데이터 초기화"><RotateCcw size={16} /><span>초기화</span></button> : null}
        <button type="button" className={styles.logout} onClick={auth.signOut} aria-label="로그아웃"><LogOut size={17} /><span>로그아웃</span></button>
      </div>
    </header>
  );
}
