// Frozen training-selection runner-up. The primary RL factory uses the selected settings in its checkpoint.
export function selectionRunnerUp(model) {
  if (model?.format !== "fleet-addguard-v1" || model.seed !== 101) throw new TypeError("The comparison requires addguard fit 101.");
  const candidate = model.selection.candidates.find(c => c.settings.fraction === 0.2);
  if (!Number.isFinite(candidate?.settings.above)) throw new Error("Missing frozen selection candidate.");
  return {...model, settings:candidate.settings};
}
