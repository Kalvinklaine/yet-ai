export const githubIdePlatforms = Object.freeze([
  Object.freeze({ label: "linux-x64", os: "linux", arch: "x64" }),
  Object.freeze({ label: "macos-arm64", os: "macos", arch: "arm64" }),
  Object.freeze({ label: "windows-x64", os: "windows", arch: "x64" }),
]);

export const publicGithubIdeArtifactFamilies = Object.freeze([
  "vscode-unzip-first",
  "jetbrains-install-direct",
  "plugin-manifest",
]);

export const expectedPublicGithubIdeArtifactCount = 7;

export const githubIdeArtifactStagingPaths = Object.freeze([
  "dist/github-artifacts/vscode-unzip-first/*",
  "dist/github-artifacts/jetbrains-install-direct/*",
]);

export const githubIdeArtifactStagingDirs = Object.freeze([
  "dist/github-artifacts/vscode-unzip-first",
  "dist/github-artifacts/jetbrains-install-direct",
]);

export const githubIdeWorkflowMatrixUploadArtifactNames = Object.freeze([
  "yet-ai-vscode-unzip-first-${{ matrix.label }}-${{ github.sha }}",
  "yet-ai-jetbrains-install-direct-${{ matrix.label }}-${{ github.sha }}",
]);

export const githubIdeWorkflowCombinedUploadArtifactName = "yet-ai-plugin-manifest-${{ github.sha }}";

export function expectedPublicGithubIdeArtifactNames(sha) {
  return Object.freeze([
    ...githubIdePlatforms.map((platform) => `yet-ai-vscode-unzip-first-${platform.label}-${sha}`),
    ...githubIdePlatforms.map((platform) => `yet-ai-jetbrains-install-direct-${platform.label}-${sha}`),
    `yet-ai-plugin-manifest-${sha}`,
  ]);
}
