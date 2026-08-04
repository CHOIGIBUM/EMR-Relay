import type { PatientAssessment, VoiceProposalChange } from "./types";

export const VOICE_FIELD_LABELS: Record<string, string> = {
  "patient.age": "나이",
  "patient.sex": "성별",
  "assessment.airway": "기도",
  "assessment.breathing": "호흡",
  "assessment.circulation": "순환",
  "consciousness.avpu": "의식 수준(AVPU)",
  "symptoms.chiefComplaint": "주호소",
  "assessment.cpss.face": "안면 마비",
  "assessment.cpss.arm": "팔 처짐",
  "assessment.cpss.speech": "언어 이상",
  "assessment.cpss.score": "CPSS 점수",
  "symptoms.lastKnownNormalAt": "마지막 정상 확인",
  "symptoms.lastKnownNormalBasis": "마지막 정상 확인 근거",
  "symptoms.firstAbnormalAt": "최초 이상 발견",
  "vitals.systolicBp": "수축기혈압",
  "vitals.diastolicBp": "이완기혈압",
  "vitals.pulse": "맥박",
  "vitals.respiratoryRate": "호흡수",
  "vitals.spo2": "산소포화도",
  "vitals.glucose": "혈당",
  "vitals.temperature": "체온",
};

function numberValue(value: VoiceProposalChange["value"]) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timeValue(value: VoiceProposalChange["value"]) {
  if (typeof value !== "string") return undefined;
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sideValue(value: VoiceProposalChange["value"]): PatientAssessment["face"] {
  if (value === "정상") return "normal";
  if (value === "좌측 이상") return "left";
  if (value === "우측 이상") return "right";
  if (value === "평가 불가") return "unassessable";
  return undefined;
}

export function applyVoiceChangesToAssessment(
  assessment: PatientAssessment,
  changes: readonly VoiceProposalChange[],
): PatientAssessment {
  const patch: PatientAssessment = {};
  for (const change of changes) {
    const value = change.value;
    switch (change.path) {
      case "patient.age": patch.age = numberValue(value); break;
      case "patient.sex": patch.sex = value === "여성" ? "female" : value === "남성" ? "male" : value === "미상" ? "unknown" : undefined; break;
      case "assessment.airway": patch.airway = value === "개방" ? "patent" : value === "확보 필요" ? "at-risk" : undefined; break;
      case "assessment.breathing": patch.breathing = value === "자발호흡" ? "adequate" : value === "호흡 이상" ? "inadequate" : undefined; break;
      case "assessment.circulation": patch.circulation = value === "맥박 촉지" ? "stable" : value === "순환 불안정" ? "poor-perfusion" : undefined; break;
      case "consciousness.avpu": if (["A", "V", "P", "U"].includes(String(value))) patch.avpu = value as PatientAssessment["avpu"]; break;
      case "symptoms.chiefComplaint": if (typeof value === "string") patch.chiefComplaint = value; break;
      case "assessment.cpss.face": patch.face = sideValue(value); break;
      case "assessment.cpss.arm": patch.arm = sideValue(value); break;
      case "assessment.cpss.speech": patch.speech = value === "정상" ? "normal" : value === "구음장애" ? "dysarthria" : value === "실어증" ? "aphasia" : value === "평가 불가" ? "unassessable" : undefined; break;
      case "symptoms.lastKnownNormalAt": patch.lastKnownWell = timeValue(value); break;
      case "symptoms.lastKnownNormalBasis": if (typeof value === "string") patch.lastKnownWellBasis = value; break;
      case "symptoms.firstAbnormalAt": patch.firstAbnormalTime = timeValue(value); break;
      case "vitals.systolicBp": patch.systolicBp = numberValue(value); break;
      case "vitals.diastolicBp": patch.diastolicBp = numberValue(value); break;
      case "vitals.pulse": patch.pulse = numberValue(value); break;
      case "vitals.respiratoryRate": patch.respiratoryRate = numberValue(value); break;
      case "vitals.spo2": patch.spo2 = numberValue(value); break;
      case "vitals.glucose": patch.glucose = numberValue(value); break;
      case "vitals.temperature": patch.temperature = numberValue(value); break;
    }
    // A proposal's observedAt is the speech-update time. It is a useful
    // fallback for a voice-only entry, but must not overwrite a measurement
    // time that the paramedic already entered explicitly.
    if (change.path.startsWith("vitals.") && change.observedAt && !assessment.measuredAt && !patch.measuredAt) {
      patch.measuredAt = timeValue(change.observedAt);
    }
  }
  return Object.fromEntries(Object.entries({ ...assessment, ...patch }).filter(([, value]) => value !== undefined)) as PatientAssessment;
}

export function displayVoiceValue(change: VoiceProposalChange) {
  const value = Array.isArray(change.value) ? change.value.join(", ") : String(change.value ?? "미상");
  return change.unit ? `${value} ${change.unit}` : value;
}
