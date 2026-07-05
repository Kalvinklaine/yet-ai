export type DogfoodStep = "read" | "edit" | "verify";

export function stepSummary(step: DogfoodStep): string {
  if (step === "read") {
    return "bounded read";
  }
  if (step === "edit") {
    return "bounded edit";
  }
  if (step === "verify") {
    return "bounded verification";
  }
  return "bounded verification";
}
