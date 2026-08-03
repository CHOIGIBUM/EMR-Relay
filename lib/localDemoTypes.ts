/** Health-check contract for the explicit local development backend. */
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
