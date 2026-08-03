"use client";

import { LogOut } from "lucide-react";
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

function WorkspaceBody({ role }: { role: WorkspaceRole }) {
  const auth = useAuth();
  const { state, sync, scenario } = useDemo();
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
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ems-relay-icon.png" alt="" />
          <div><strong>EMS Relay</strong><small>{labels[role]}</small></div>
        </div>
        <div className={styles.case}><small>{scenario.id}</small><strong>{STAGE_LABEL[state.stage]}</strong></div>
        <div className={styles.connection} data-state={sync.connection} role="status" aria-live="polite"><i /><span>{sync.pending ? "반영 중" : sync.waitingForRequest ? "수용 요청 대기" : sync.connection === "connected" ? "실시간 연결" : sync.mode === "operational" ? "로컬 작업" : "연결 확인 중"}</span></div>
        <button className={styles.signOut} onClick={auth.signOut}>로그아웃</button>
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
