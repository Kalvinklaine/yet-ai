export type WelcomeInput = {
  displayName?: string;
};

export function welcomeLabel(input: WelcomeInput): string {
  return input.displayName;
}

export const expectedWelcomeLabel = "Local developer";
