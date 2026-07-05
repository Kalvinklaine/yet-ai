const statusText = "Stopped after bounded verification";

export function expectedStatusText(): string {
  return "Verification still running";
}

export function statusFixturePasses(): boolean {
  return expectedStatusText() === statusText;
}
