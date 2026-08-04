import { Activity, Clock3, ShieldCheck, UserRound } from "lucide-react";
import type { ConfirmedPatientCard } from "@/lib/v2/types";
import styles from "./V2.module.css";

const side = { normal: "정상", left: "좌측 이상", right: "우측 이상", unassessable: "평가 불가" } as const;
const speech = { normal: "정상", dysarthria: "구음장애", aphasia: "실어증", unassessable: "평가 불가" } as const;

export default function PatientCard({ card, compact = false }: { card: ConfirmedPatientCard; compact?: boolean }) {
  return (
    <section className={`${styles.patientCard} ${compact ? styles.patientCardCompact : ""}`}>
      <div className={styles.patientHeading}>
        <span className={styles.patientAvatar}><UserRound /></span>
        <div><small>확정 환자 카드</small><h2>{card.age}세 · {card.sex === "female" ? "여성" : card.sex === "male" ? "남성" : "성별 미상"}</h2><p>{card.chiefComplaint}</p></div>
        <b><ShieldCheck /> 구급대원 확인</b>
      </div>
      <div className={styles.clinicalBand}>
        <span><Activity /><small>CPSS</small><strong>{card.cpss}/3</strong></span>
        <span><small>안면</small><strong>{side[card.face!]}</strong></span>
        <span><small>팔</small><strong>{side[card.arm!]}</strong></span>
        <span><small>언어</small><strong>{speech[card.speech!]}</strong></span>
      </div>
      <div className={styles.timeBand}>
        <span><Clock3 /><small>마지막 정상 확인</small><strong>{card.lastKnownWell}</strong></span>
        <span><Clock3 /><small>최초 이상 발견</small><strong>{card.firstAbnormalTime}</strong></span>
        <span><Clock3 /><small>활력 측정</small><strong>{card.measuredAt}</strong></span>
      </div>
      <div className={styles.vitals}>
        <span><small>BP</small><strong>{card.systolicBp}/{card.diastolicBp}</strong><em>mmHg</em></span>
        <span><small>PR</small><strong>{card.pulse}</strong><em>회/분</em></span>
        <span><small>RR</small><strong>{card.respiratoryRate}</strong><em>회/분</em></span>
        <span><small>SpO₂</small><strong>{card.spo2}</strong><em>%</em></span>
        <span><small>혈당</small><strong>{card.glucose}</strong><em>mg/dL</em></span>
        <span><small>AVPU</small><strong>{card.avpu}</strong><em>의식</em></span>
      </div>
      {!compact && card.voiceNote ? <div className={styles.voiceNote}><small>음성 메모</small><p>{card.voiceNote}</p></div> : null}
    </section>
  );
}
