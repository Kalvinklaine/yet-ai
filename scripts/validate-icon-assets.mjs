import { readFile, stat } from "node:fs/promises";

const errors = [];

const iconPaths = {
  sourceSvg: "assets/identity/yet-ai-icon.svg",
  sourcePng128: "assets/identity/yet-ai-icon-128.png",
  sourcePng256: "assets/identity/yet-ai-icon-256.png",
  vscodePng: "apps/plugins/vscode/media/yet-ai-icon-128.png",
  jetbrainsSvg: "apps/plugins/jetbrains/src/main/resources/META-INF/pluginIcon.svg"
};

function addError(path, message) {
  errors.push(`${path}: ${message}`);
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    addError(path, `cannot read file (${error.message})`);
    return null;
  }
}

async function readBytes(path) {
  try {
    return await readFile(path);
  } catch (error) {
    addError(path, `cannot read file (${error.message})`);
    return null;
  }
}

async function requireFile(path) {
  try {
    const details = await stat(path);
    if (!details.isFile()) {
      addError(path, "must be a file");
    }
  } catch (error) {
    addError(path, `missing file (${error.message})`);
  }
}

function validateSvg(path, svg) {
  if (!svg) {
    return;
  }

  if (!/<svg[\s>]/i.test(svg)) {
    addError(path, "must contain an SVG root element");
  }

  const forbiddenPatterns = [
    [/<script\b/i, "must not contain script elements"],
    [/<foreignObject\b/i, "must not contain foreignObject elements"],
    [/\bon\w+\s*=/i, "must not contain inline event handlers"],
    [/\b(?:href|xlink:href)\s*=\s*["'](?:https?:|data:|\/\/)/i, "must not contain external or embedded href references"],
    [/url\(\s*["']?(?:https?:|data:|\/\/)/i, "must not contain external or embedded url references"],
    [/<image\b/i, "must not contain image elements"]
  ];

  for (const [pattern, message] of forbiddenPatterns) {
    if (pattern.test(svg)) {
      addError(path, message);
    }
  }
}

function validatePng(path, bytes) {
  if (!bytes) {
    return;
  }

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < pngSignature.length || !bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
    addError(path, "must be a PNG file");
  }
}

function requireSameContent(leftPath, left, rightPath, right, description) {
  if (!left || !right) {
    return;
  }

  if (!left.equals(right)) {
    addError(rightPath, `must match ${leftPath} (${description})`);
  }
}

for (const path of Object.values(iconPaths)) {
  await requireFile(path);
}

const sourceSvg = await readText(iconPaths.sourceSvg);
const jetbrainsSvg = await readText(iconPaths.jetbrainsSvg);
validateSvg(iconPaths.sourceSvg, sourceSvg);
validateSvg(iconPaths.jetbrainsSvg, jetbrainsSvg);

const sourcePng128 = await readBytes(iconPaths.sourcePng128);
const sourcePng256 = await readBytes(iconPaths.sourcePng256);
const vscodePng = await readBytes(iconPaths.vscodePng);
validatePng(iconPaths.sourcePng128, sourcePng128);
validatePng(iconPaths.sourcePng256, sourcePng256);
validatePng(iconPaths.vscodePng, vscodePng);

if (sourceSvg && jetbrainsSvg && sourceSvg !== jetbrainsSvg) {
  addError(iconPaths.jetbrainsSvg, `must match ${iconPaths.sourceSvg} as the JetBrains plugin icon source copy`);
}

requireSameContent(iconPaths.sourcePng128, sourcePng128, iconPaths.vscodePng, vscodePng, "VS Code package icon copy");

const vscodeManifest = JSON.parse(await readFile("apps/plugins/vscode/package.json", "utf8"));
if (vscodeManifest.icon !== "media/yet-ai-icon-128.png") {
  addError("apps/plugins/vscode/package.json", "icon must be media/yet-ai-icon-128.png");
}

if (errors.length > 0) {
  console.error("Icon asset validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Icon asset validation passed.");
