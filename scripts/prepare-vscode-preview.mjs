import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vscodeRoot = path.join(root, "apps", "plugins", "vscode");
const rootDistDir = path.join(root, "dist", "plugins", "vscode");
const args = process.argv.slice(2);
const identity = JSON.parse(await readFile(path.join(root, "product", "identity.json"), "utf8"));
const vscodePackage = JSON.parse(await readFile(path.join(vscodeRoot, "package.json"), "utf8"));

function run(command, commandArgs, options = {}) {
  const printable = [command, ...commandArgs].join(" ");
  console.log(`\n> ${printable}`);
  const result = spawnSync(platformCommand(command), commandArgs, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error?.code === "ENOENT") {
    console.error(`Required command \`${command}\` was not found on PATH.`);
    if (command === "zip") {
      console.error("Install a local zip archiver or add a reviewed dependency-free Node archive writer before preparing the VS Code dev-preview VSIX.");
    }
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function platformCommand(command) {
  if (process.platform !== "win32") {
    return command;
  }
  return {
    npm: "npm.cmd",
    zip: "zip.exe",
  }[command] ?? command;
}

run("npm", ["run", "prepare:ide-engine", "--", ...args]);
run("npm", ["run", "build"], { cwd: path.join(root, "apps", "gui") });
run("npm", ["run", "prepare:preview"], { cwd: vscodeRoot });

const binaryFileName = process.platform === "win32" ? `${identity.engine.binaryName}.exe` : identity.engine.binaryName;
const distVsixName = `${identity.product.id}-vscode-${vscodePackage.version}-dev-preview.vsix`;
const distVsixPath = path.join(rootDistDir, distVsixName);
const distChecksumPath = `${distVsixPath}.sha256`;
const checksum = await publishDevPreviewArtifact(distVsixPath, distChecksumPath);

console.log("\nVS Code dev preview is prepared.");
console.log("Open apps/plugins/vscode in VS Code, start an Extension Development Host, then run Yet AI: Open Chat.");
console.log("Generated GUI assets, engine binaries, and root dist artifacts are ignored and must not be committed.");
console.log("\nStable root dev-preview artifact:");
console.log(`  ${distVsixPath}`);
console.log(`  ${distChecksumPath}`);
console.log(`  sha256 ${checksum}`);
console.log("\nThis is a local dev-preview VSIX only: no signing, marketplace publishing, production installer, or notarized bundled engine is produced.");

async function publishDevPreviewArtifact(distVsixPath, distChecksumPath) {
  await validatePreparedPreview();
  await mkdir(rootDistDir, { recursive: true });
  const entries = await readdir(rootDistDir).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.endsWith("-dev-preview.vsix") || entry.endsWith("-dev-preview.vsix.sha256"))
    .map((entry) => rm(path.join(rootDistDir, entry), { force: true })));

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "yet-ai-vscode-vsix-"));
  try {
    await stageVsix(tempRoot);
    run("zip", ["-qr", distVsixPath, "."], { cwd: tempRoot });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  const checksum = createHash("sha256").update(await readFile(distVsixPath)).digest("hex");
  await writeFile(distChecksumPath, `${checksum}  ${path.basename(distVsixPath)}\n`, "utf8");
  return checksum;
}

async function validatePreparedPreview() {
  const requiredFiles = [
    [path.join(vscodeRoot, "package.json"), "VS Code package metadata is missing at apps/plugins/vscode/package.json."],
    [path.join(vscodeRoot, "README.md"), "VS Code README is missing at apps/plugins/vscode/README.md."],
    [path.join(vscodeRoot, "out", "extension.js"), "Compiled VS Code extension is missing. Run `cd apps/plugins/vscode && npm run compile` or `npm run prepare:vscode-preview` first."],
    [path.join(vscodeRoot, "out", "product", "identity.json"), "Bundled VS Code product identity is missing. Run `cd apps/plugins/vscode && npm run copy:identity` or `npm run prepare:vscode-preview` first."],
    [path.join(vscodeRoot, "media", "gui", "index.html"), "Packaged GUI dist is missing. Run `cd apps/gui && npm run build`, then `cd apps/plugins/vscode && npm run copy:gui`, or run `npm run prepare:vscode-preview` first."],
    [path.join(vscodeRoot, "bin", binaryFileName), `Copied engine binary is missing at apps/plugins/vscode/bin/${binaryFileName}. Run \`npm run prepare:ide-engine\` or \`npm run prepare:vscode-preview\` first.`],
  ];

  for (const [filePath, message] of requiredFiles) {
    await requireFile(filePath, message);
  }

  await requireDirectory(path.join(vscodeRoot, "out"), "Compiled VS Code out directory is missing. Run `cd apps/plugins/vscode && npm run compile` or `npm run prepare:vscode-preview` first.");
  await requireDirectory(path.join(vscodeRoot, "media", "gui"), "Packaged GUI media directory is missing. Run `npm run prepare:vscode-preview` first.");
  await requireDirectory(path.join(vscodeRoot, "bin"), "VS Code engine bin directory is missing. Run `npm run prepare:ide-engine` or `npm run prepare:vscode-preview` first.");
}

async function requireFile(filePath, message) {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      return;
    }
  } catch {
  }
  console.error(`${message} Expected file: ${path.relative(root, filePath)}.`);
  process.exit(1);
}

async function requireDirectory(directoryPath, message) {
  try {
    const directoryStat = await stat(directoryPath);
    if (directoryStat.isDirectory()) {
      return;
    }
  } catch {
  }
  console.error(`${message} Expected directory: ${path.relative(root, directoryPath)}.`);
  process.exit(1);
}

async function stageVsix(tempRoot) {
  const extensionDir = path.join(tempRoot, "extension");
  await mkdir(extensionDir, { recursive: true });
  await copyFile(path.join(vscodeRoot, "package.json"), path.join(extensionDir, "package.json"));
  await copyFile(path.join(vscodeRoot, "README.md"), path.join(extensionDir, "README.md"));
  await copyDirectory(path.join(vscodeRoot, "out"), path.join(extensionDir, "out"));
  await copyDirectory(path.join(vscodeRoot, "media", "gui"), path.join(extensionDir, "media", "gui"));
  await copyDirectory(path.join(vscodeRoot, "bin"), path.join(extensionDir, "bin"));
  await writeFile(path.join(tempRoot, "extension.vsixmanifest"), vsixManifest(), "utf8");
  await writeFile(path.join(tempRoot, "[Content_Types].xml"), contentTypes(), "utf8");
}

async function copyDirectory(source, target) {
  await cp(source, target, {
    recursive: true,
    filter: (entry) => shouldInclude(entry),
  });
}

function shouldInclude(entry) {
  const relativeEntry = path.relative(vscodeRoot, entry).split(path.sep).join("/");
  if (relativeEntry.length === 0) {
    return true;
  }
  const basename = path.basename(entry);
  if (basename === ".git" || basename === ".yet-ai" || basename === "node_modules") {
    return false;
  }
  if (relativeEntry.includes("/node_modules/") || relativeEntry.includes("/.git/") || relativeEntry.includes("/.yet-ai/")) {
    return false;
  }
  if (relativeEntry.endsWith(".map") || relativeEntry.endsWith(".vsix")) {
    return false;
  }
  return true;
}

function vsixManifest() {
  const publisher = typeof vscodePackage.publisher === "string" ? vscodePackage.publisher : identity.vscode.publisher;
  const extensionName = typeof vscodePackage.name === "string" ? vscodePackage.name : identity.vscode.name;
  const displayName = typeof vscodePackage.displayName === "string" ? vscodePackage.displayName : identity.vscode.displayName;
  const description = typeof vscodePackage.description === "string" ? vscodePackage.description : "Yet AI local dev-preview VS Code extension.";
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapeXml(extensionName)}" Version="${escapeXml(vscodePackage.version)}" Publisher="${escapeXml(publisher)}" />
    <DisplayName>${escapeXml(displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(description)}</Description>
    <Tags>dev-preview</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Private</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(vscodePackage.engines?.vscode ?? "^1.90.0")}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

function contentTypes() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="wasm" ContentType="application/wasm" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="" ContentType="application/octet-stream" />
  <Override PartName="/extension.vsixmanifest" ContentType="text/xml" />
</Types>
`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
