import {
  INITIAL_ASSESSMENT_REQUIRED_PATHS,
  INITIAL_ASSESSMENT_REQUIRED_PATHS_BY_STEP,
  type ConfirmedState,
  type FactPath,
} from "./types.js";

function hasConfirmedValue(state: ConfirmedState, path: FactPath) {
  const fact = state.facts[path];
  if (!fact) return false;
  if (fact.value === null || fact.value === "") return false;
  return !Array.isArray(fact.value) || fact.value.length > 0;
}

export function missingInitialAssessmentPaths(state: ConfirmedState): FactPath[] {
  return INITIAL_ASSESSMENT_REQUIRED_PATHS.filter((path) => !hasConfirmedValue(state, path));
}

export function completedInitialAssessmentSteps(state: ConfirmedState): Array<1 | 2 | 3> {
  return ([1, 2, 3] as const).filter((step) => (
    INITIAL_ASSESSMENT_REQUIRED_PATHS_BY_STEP[step].every((path) => hasConfirmedValue(state, path))
  ));
}

