import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

const errors = [];

const iconPaths = {
  sourceSvg: "assets/identity/yet-ai-icon.svg",
  sourcePng128: "assets/identity/yet-ai-icon-128.png",
  sourcePng256: "assets/identity/yet-ai-icon-256.png",
  vscodePng: "apps/plugins/vscode/media/yet-ai-icon-128.png",
  jetbrainsSvg: "apps/plugins/jetbrains/src/main/resources/META-INF/pluginIcon.svg",
  derivativeMetadata: "assets/identity/yet-ai-icon-derivatives.json"
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

async function readJson(path) {
  const text = await readText(path);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    addError(path, `must be valid JSON (${error.message})`);
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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
    [/<image\b/i, "must not contain image elements"],
    [/\bon\w+\s*=/i, "must not contain inline event handlers"]
  ];

  for (const [pattern, message] of forbiddenPatterns) {
    if (pattern.test(svg)) {
      addError(path, message);
    }
  }

  for (const match of svg.matchAll(/\b(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi)) {
    if (!match[2].startsWith("#")) {
      addError(path, "href references must use internal fragments only");
    }
  }

  for (const match of svg.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    if (!match[2].startsWith("#")) {
      addError(path, "url references must use internal fragments only");
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

function requirePngSize(path, bytes, expectedSize) {
  if (!bytes || bytes.length < 24) {
    return;
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== expectedSize || height !== expectedSize) {
    addError(path, `must be ${expectedSize}x${expectedSize}px`);
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

function requireHash(path, bytes, expectedHash, description) {
  if (!bytes) {
    return;
  }

  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    addError(path, `must have a sha256 value in ${description}`);
    return;
  }

  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) {
    addError(path, `sha256 must match ${description} (${expectedHash})`);
  }
}

function validateDerivativeMetadata(metadata, sourceSvgBytes, sourcePng128, sourcePng256) {
  if (!metadata) {
    return;
  }

  if (metadata.sourceSvg !== iconPaths.sourceSvg) {
    addError(iconPaths.derivativeMetadata, `sourceSvg must be ${iconPaths.sourceSvg}`);
  }

  requireHash(iconPaths.sourceSvg, sourceSvgBytes, metadata.sourceSvgSha256, iconPaths.derivativeMetadata);

  const expectedDerivatives = [
    [iconPaths.sourcePng128, sourcePng128, 128],
    [iconPaths.sourcePng256, sourcePng256, 256]
  ];

  for (const [path, bytes, size] of expectedDerivatives) {
    const record = metadata.derivatives?.[path];
    if (!record) {
      addError(iconPaths.derivativeMetadata, `must record ${path}`);
      continue;
    }

    if (record.size !== size) {
      addError(iconPaths.derivativeMetadata, `${path} size must be ${size}`);
    }

    requireHash(path, bytes, record.sha256, iconPaths.derivativeMetadata);
  }
}

for (const path of Object.values(iconPaths)) {
  await requireFile(path);
}

const sourceSvg = await readText(iconPaths.sourceSvg);
const jetbrainsSvg = await readText(iconPaths.jetbrainsSvg);
validateSvg(iconPaths.sourceSvg, sourceSvg);
validateSvg(iconPaths.jetbrainsSvg, jetbrainsSvg);

const sourceSvgBytes = await readBytes(iconPaths.sourceSvg);
const sourcePng128 = await readBytes(iconPaths.sourcePng128);
const sourcePng256 = await readBytes(iconPaths.sourcePng256);
const vscodePng = await readBytes(iconPaths.vscodePng);
validatePng(iconPaths.sourcePng128, sourcePng128);
validatePng(iconPaths.sourcePng256, sourcePng256);
validatePng(iconPaths.vscodePng, vscodePng);
requirePngSize(iconPaths.sourcePng128, sourcePng128, 128);
requirePngSize(iconPaths.sourcePng256, sourcePng256, 256);
requirePngSize(iconPaths.vscodePng, vscodePng, 128);

const derivativeMetadata = await readJson(iconPaths.derivativeMetadata);
validateDerivativeMetadata(derivativeMetadata, sourceSvgBytes, sourcePng128, sourcePng256);

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
