"use client";

import Image from "next/image";
import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import ControlConsole from "./ControlConsole";
import HospitalConsole from "./HospitalConsole";
import MobileApp from "./MobileApp";
import ReportConsole from "./ReportConsole";
import { DemoProvider, STAGE_LABEL, useDemo } from "./DemoContext";
import RoleGate from "./auth/RoleGate";
import { useAuth } from "./auth/AuthProvider";
import type { OperationalRole } from "@/lib/operationalTypes";
import styles from "./OperationalWorkspace.module.css";

type WorkspaceRole = "paramedic" | "control" | "hospital" | "reports";

const labels: Record<WorkspaceRole, string> = {
  paramedic: "구급대원 현장 기록",
  control: "이송조정 상황실",
  hospital: "병원 수용 담당",
  reports: "구급활동 기록",
};

const roleLanding: Record<WorkspaceRole, string> = {
  paramedic: "/paramedic",
  control: "/control",
  hospital: "/hospital",
  reports: "/reports",
};

function WorkspaceBody({ role }: { role: WorkspaceRole }) {
  const auth = useAuth();
  const { state, sync, scenario } = useDemo();
  const connectionLabel = sync.pending
    ? "반영 중"
    : sync.waitingForRequest
      ? "수용 요청 대기"
      : sync.connection === "connected"
        ? "실시간 연결"
        : sync.connection === "error" || sync.connection === "disconnected"
          ? "연결 끊김"
          : "연결 확인 중";
  if (role === "paramedic") return (
    <main className={styles.mobile}>
      <div className={styles.mobileTools}><button aria-label="로그아웃" onClick={auth.signOut}><LogOut size={18} /></button></div>
      {sync.error && <p className={styles.error} role="alert">{sync.error}</p>}
      <MobileApp operational />
    </main>
  );
  return (
    <div className={styles.workspace}>
      <header className={styles.desktopHeader}>
        <Link className={styles.brand} href={roleLanding[role]} aria-label={`${labels[role]} 홈`}>
          <Image src="/ems-relay-icon.png" alt="" width={48} height={48} priority />
          <div><strong>EMS Relay</strong><small>{labels[role]}</small></div>
        </Link>
        <div className={styles.case}><small>{scenario.id}</small><strong>{STAGE_LABEL[state.stage]}</strong></div>
        <div className={styles.headerActions}>
          <div className={styles.connection} data-state={sync.connection} role="status" aria-live="polite"><i /><span>{connectionLabel}</span></div>
          <div className={styles.account} aria-label="현재 로그인 계정">
            <span className={styles.avatar}><UserRound size={18} /></span>
            <span><strong>{auth.user?.displayName || "업무 사용자"}</strong><small>{labels[role]}</small></span>
          </div>
          <button className={styles.signOut} onClick={auth.signOut}><LogOut size={16} /><span>로그아웃</span></button>
        </div>
      </header>
      {sync.error && <p className={styles.error} role="alert">{sync.error}</p>}
      <main className={styles.content}>
        {role === "control" && <ControlConsole />}
        {role === "hospital" && <HospitalConsole />}
        {role === "reports" && <ReportConsole />}
      </main>
    </div>
  );
}

export default function OperationalWorkspace({ role }: { role: WorkspaceRole }) {
  const allowed: OperationalRole[] = role === "reports" ? ["paramedic", "admin"] : [role];
  const operationalRole: OperationalRole = role === "reports" ? "admin" : role;
  const caseId = process.env.NEXT_PUBLIC_EMS_DEFAULT_CASE_ID?.trim() || "UNASSIGNED";
  return (
    <RoleGate allow={allowed}>
      <DemoProvider operational caseId={caseId} operationalRole={operationalRole}><WorkspaceBody role={role} /></DemoProvider>
    </RoleGate>
  );
}
