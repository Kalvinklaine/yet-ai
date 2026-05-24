import * as fs from "node:fs";
import * as path from "node:path";

export type VsCodeIdentity = {
  publisher: string;
  name: string;
  displayName: string;
  configurationPrefix: string;
  commandPrefix: string;
  activityBarId: string;
};

export type ProductIdentity = {
  product: {
    id: string;
    displayName: string;
  };
  engine: {
    binaryName: string;
  };
  gui: {
    npmPackage: string;
  };
  vscode: VsCodeIdentity;
};

export const extensionCommand = "yetaicmd.openChat";
export const runtimeStatusCommand = "yetaicmd.showRuntimeStatus";
export const configurationPrefix = "yetai";
export const bridgeVersion = "2026-05-15";

export function loadProductIdentity(extensionPath: string): ProductIdentity {
  const identityPath = path.resolve(extensionPath, "..", "..", "..", "product", "identity.json");
  const raw = fs.readFileSync(identityPath, "utf8");
  return JSON.parse(raw) as ProductIdentity;
}

export function assertExtensionIdentity(identity: ProductIdentity): void {
  const expected = identity.vscode;
  if (expected.commandPrefix !== "yetaicmd") {
    throw new Error("VS Code command prefix does not match extension command registration.");
  }
  if (expected.configurationPrefix !== configurationPrefix) {
    throw new Error("VS Code configuration prefix does not match extension configuration registration.");
  }
}
