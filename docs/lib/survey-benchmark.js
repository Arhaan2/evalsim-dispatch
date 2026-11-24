import { createFreightBenchmark } from "./freight-benchmark.js";
import { SURVEY_SUITE, SURVEY_PATTERNS, surveyCases, createSurvey, observeSurvey, stepSurvey, verifySurvey } from "./survey.js";
import { chooseSurvey } from "./survey-policy.js";
import { rallyReferences, rallyWeights } from "./rally-benchmark.js";

export const SURVEY_REPORT = "evalsim-survey-report-v1";
export const SURVEY_EVALUATION_SPLITS = Object.freeze(["validation", "test", "retention", "archive"]);

export function surveyWeights(release, ...priorReleases) {
  const { weights, alwaysWeights, neverWeights } = release.checkpoint;
  return { ...rallyWeights(...priorReleases), survey: weights, always: alwaysWeights, never: neverWeights };
}

export function surveyReferences(weights) {
  const { rl: rally, ...previous } = rallyReferences(weights);
  return {
    rl: o => chooseSurvey(o, weights.survey),
    always: o => chooseSurvey(o, weights.always),
    never: o => chooseSurvey(o, weights.never),
    rally, ...previous,
  };
}

export const { runCase: runSurveyCase, benchmark: benchmarkSurvey, verifyReport: verifySurveyReport } =
  createFreightBenchmark({
    id: SURVEY_SUITE.id, format: SURVEY_REPORT, cases: surveyCases, references: surveyReferences,
    splits: SURVEY_EVALUATION_SPLITS, stratum: family => SURVEY_PATTERNS[family].stratum,
    ending: family => SURVEY_PATTERNS[family].ending,
    world: { create: createSurvey, observe: observeSurvey, step: stepSurvey, verify: verifySurvey },
  });
