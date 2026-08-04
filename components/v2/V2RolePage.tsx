"use client";

import RoleGate from "@/components/auth/RoleGate";
import HospitalApp from "./HospitalApp";
import ParamedicApp from "./ParamedicApp";
import { V2Provider } from "./V2Provider";

export default function V2RolePage({ role }: { role: "paramedic" | "hospital" }) {
  return (
    <RoleGate allow={[role]}>
      <V2Provider role={role}>{role === "paramedic" ? <ParamedicApp /> : <HospitalApp />}</V2Provider>
    </RoleGate>
  );
}
