export type LocalHospitalCandidate = {
  id: string;
  name: string;
  type: string;
  distance: string;
  eta: string;
  location: string;
  reference: string[];
};

export type LocalHospitalsResponse = {
  hospitals: LocalHospitalCandidate[];
  dataSource: "local-demo-fixture";
  referenceTimestamp: string;
};

export type LocalServiceState = {
  status: "available";
  provider: string;
};

export type LocalHealthResponse = {
  status: "ok";
  mode: "local-mock";
  services: {
    agent: LocalServiceState;
    hospitals: LocalServiceState;
    persistence: LocalServiceState;
  };
  checkedAt: string;
};
