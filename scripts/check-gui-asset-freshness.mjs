import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertPackagedGuiFreshness, assertPackagedGuiFreshnessInArchive } from "./gui-asset-freshness.mjs";

const failures = [];

await withTempFixture(async (fixtureRoot) => {
  await runDirectoryCases(fixtureRoot);
  await runArchiveCases(fixtureRoot);
});

if (failures.length > 0) {
  console.error("GUI asset freshness self-test failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("GUI asset freshness self-test passed.");
console.log("Checked fresh and stale directory/archive fixtures, missing and mismatched JS/CSS assets, stale extras, and unsafe local references.");

async function runDirectoryCases(fixtureRoot) {
  await expectDirectoryPass(fixtureRoot, "directory fresh source/package passes", {});
  await expectDirectoryFail(fixtureRoot, "directory missing packaged index.html fails", { removePackaged: ["index.html"] }, /missing index\.html/i);
  await expectDirectoryFail(fixtureRoot, "directory mismatched index.html fails", { packagedOverrides: { "index.html": html("assets/app.js", "assets/app.css", "changed") } }, /index\.html differs/i);
  await expectDirectoryFail(fixtureRoot, "directory missing referenced JS asset fails", { removePackaged: ["assets/app.js"] }, /missing asset assets\/app\.js/i);
  await expectDirectoryFail(fixtureRoot, "directory changed referenced CSS asset fails", { packagedOverrides: { "assets/app.css": "stale css" } }, /asset assets\/app\.css differs/i);
  await expectDirectoryFail(fixtureRoot, "directory missing unreferenced JS chunk fails", { removePackaged: ["assets/chunk.js"] }, /missing JS\/CSS asset assets\/chunk\.js/i);
  await expectDirectoryFail(fixtureRoot, "directory changed unreferenced CSS chunk fails", { packagedOverrides: { "assets/chunk.css": "stale chunk css" } }, /JS\/CSS asset assets\/chunk\.css differs/i);
  await expectDirectoryFail(fixtureRoot, "directory stale extra assets/index-old.js fails", { packagedOverrides: { "assets/index-old.js": "old" } }, /stale extra JS\/CSS asset assets\/index-old\.js/i);
  await expectDirectoryFail(fixtureRoot, "directory unsafe local reference like ../secret.js fails", { sourceOverrides: { "index.html": html("../secret.js", "assets/app.css") }, packagedOverrides: { "index.html": html("../secret.js", "assets/app.css") } }, /unsafe local JS\/CSS asset "\.\.\/secret\.js"/i);
  await expectDirectoryFail(fixtureRoot, "directory unsafe backslash local reference fails", { sourceOverrides: { "index.html": html("assets\\\\app.js", "assets/app.css") }, packagedOverrides: { "index.html": html("assets\\\\app.js", "assets/app.css") } }, /unsafe local JS\/CSS asset "assets\\\\\\\\app\.js"/i);
  await expectDirectoryFail(fixtureRoot, "directory unsafe encoded traversal local reference fails", { sourceOverrides: { "index.html": html("assets/%2e%2e/secret.js", "assets/app.css") }, packagedOverrides: { "index.html": html("assets/%2e%2e/secret.js", "assets/app.css") } }, /unsafe local JS\/CSS asset "assets\/%2e%2e\/secret\.js"/i);
}

async function runArchiveCases(fixtureRoot) {
  await expectArchivePass(fixtureRoot, "archive fresh fake archive passes", {});
  await expectArchiveFail(fixtureRoot, "archive missing archive index.html fails", { removeEntries: ["pkg/gui/index.html"] }, /missing pkg\/gui\/index\.html/i);
  await expectArchiveFail(fixtureRoot, "archive missing referenced JS fails", { removeEntries: ["pkg/gui/assets/app.js"] }, /missing pkg\/gui\/assets\/app\.js/i);
  await expectArchiveFail(fixtureRoot, "archive missing referenced CSS fails", { removeEntries: ["pkg/gui/assets/app.css"] }, /missing pkg\/gui\/assets\/app\.css/i);
  await expectArchiveFail(fixtureRoot, "archive mismatched same-name chunk fails", { entryOverrides: { "pkg/gui/assets/chunk.js": "stale chunk js" } }, /pkg\/gui\/assets\/chunk\.js differs/i);
  await expectArchiveFail(fixtureRoot, "archive missing unreferenced source JS chunk fails", { removeEntries: ["pkg/gui/assets/chunk.js"] }, /missing JS\/CSS asset pkg\/gui\/assets\/chunk\.js/i);
  await expectArchiveFail(fixtureRoot, "archive missing unreferenced source CSS chunk fails", { removeEntries: ["pkg/gui/assets/chunk.css"] }, /missing JS\/CSS asset pkg\/gui\/assets\/chunk\.css/i);
  await expectArchiveFail(fixtureRoot, "archive stale extra archive JS fails", { entryOverrides: { "pkg/gui/assets/index-old.js": "old" } }, /stale extra JS\/CSS asset pkg\/gui\/assets\/index-old\.js/i);
  await expectArchiveFail(fixtureRoot, "archive stale extra archive CSS fails", { entryOverrides: { "pkg/gui/assets/index-old.css": "old" } }, /stale extra JS\/CSS asset pkg\/gui\/assets\/index-old\.css/i);
  await expectArchiveFail(fixtureRoot, "archive unsafe backslash local reference in source index fails", { sourceOverrides: { "index.html": html("assets\\\\app.js", "assets/app.css") } }, /unsafe local JS\/CSS asset "assets\\\\\\\\app\.js"/i);
  await expectArchiveFail(fixtureRoot, "archive unsafe encoded traversal local reference in source index fails", { sourceOverrides: { "index.html": html("assets/%2e%2e/secret.js", "assets/app.css") } }, /unsafe local JS\/CSS asset "assets\/%2e%2e\/secret\.js"/i);
  await expectArchiveFail(fixtureRoot, "archive unsafe backslash local reference in packaged index fails", { packagedOverrides: { "index.html": html("assets\\\\app.js", "assets/app.css") } }, /unsafe local JS\/CSS asset "assets\\\\\\\\app\.js"/i);
  await expectArchiveFail(fixtureRoot, "archive unsafe encoded traversal local reference in packaged index fails", { packagedOverrides: { "index.html": html("assets/%2e%2e/secret.js", "assets/app.css") } }, /unsafe local JS\/CSS asset "assets\/%2e%2e\/secret\.js"/i);
}

async function expectDirectoryPass(fixtureRoot, name, mutations) {
  const { sourceRoot, packagedRoot } = await createDirectoryFixture(fixtureRoot, name, mutations);
  await expectPass(name, () => assertPackagedGuiFreshness({ sourceRoot, packagedRoot, label: name }));
}

async function expectDirectoryFail(fixtureRoot, name, mutations, pattern) {
  const { sourceRoot, packagedRoot } = await createDirectoryFixture(fixtureRoot, name, mutations);
  await expectFail(name, () => assertPackagedGuiFreshness({ sourceRoot, packagedRoot, label: name }), pattern);
}

async function expectArchivePass(fixtureRoot, name, mutations) {
  const { sourceRoot, entries, readEntryBytes } = await createArchiveFixture(fixtureRoot, name, mutations);
  await expectPass(name, () => assertPackagedGuiFreshnessInArchive({ sourceRoot, entries, packagedPrefix: "pkg/gui/", label: name, readEntryBytes }));
}

async function expectArchiveFail(fixtureRoot, name, mutations, pattern) {
  const { sourceRoot, entries, readEntryBytes } = await createArchiveFixture(fixtureRoot, name, mutations);
  await expectFail(name, () => assertPackagedGuiFreshnessInArchive({ sourceRoot, entries, packagedPrefix: "pkg/gui/", label: name, readEntryBytes }), pattern);
}

async function expectPass(name, action) {
  try {
    await action();
  } catch (error) {
    failures.push(`${name}: expected pass, got ${sanitize(error)}`);
  }
}

async function expectFail(name, action, pattern) {
  try {
    await action();
    failures.push(`${name}: expected failure, got pass`);
  } catch (error) {
    const message = sanitize(error);
    if (!pattern.test(message)) failures.push(`${name}: failure did not match ${pattern}: ${message}`);
    if (/\/Users\/|[A-Za-z]:\\/.test(message)) failures.push(`${name}: diagnostic contains an absolute private path: ${message}`);
  }
}

async function createDirectoryFixture(fixtureRoot, name, mutations) {
  const sourceRoot = path.join(fixtureRoot, slug(name), "source");
  const packagedRoot = path.join(fixtureRoot, slug(name), "packaged");
  await writeFiles(sourceRoot, { ...baseFiles(), ...mutations.sourceOverrides });
  await writeFiles(packagedRoot, { ...baseFiles(), ...mutations.packagedOverrides });
  for (const relativePath of mutations.removePackaged ?? []) {
    await rm(path.join(packagedRoot, relativePath), { force: true });
  }
  return { sourceRoot, packagedRoot };
}

async function createArchiveFixture(fixtureRoot, name, mutations) {
  const sourceRoot = path.join(fixtureRoot, slug(name), "source");
  await writeFiles(sourceRoot, { ...baseFiles(), ...mutations.sourceOverrides });
  const archiveMap = new Map();
  for (const [relativePath, content] of Object.entries({ ...baseFiles(), ...mutations.packagedOverrides })) {
    archiveMap.set(`pkg/gui/${relativePath}`, Buffer.from(content));
  }
  for (const [entry, content] of Object.entries(mutations.entryOverrides ?? {})) {
    archiveMap.set(entry, Buffer.from(content));
  }
  for (const entry of mutations.removeEntries ?? []) {
    archiveMap.delete(entry);
  }
  return { sourceRoot, entries: [...archiveMap.keys()], readEntryBytes: async (entry) => archiveMap.get(entry) };
}

async function withTempFixture(callback) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "yet-ai-gui-freshness-check-"));
  try {
    await callback(tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

function baseFiles() {
  return {
    "index.html": html("assets/app.js", "assets/app.css"),
    "assets/app.js": "console.log('app');\n",
    "assets/app.css": "body{color:#123}\n",
    "assets/chunk.js": "console.log('chunk');\n",
    "assets/chunk.css": ".chunk{display:block}\n",
    "assets/image.svg": "<svg />\n",
  };
}

function html(js, css, marker = "") {
  return `<!doctype html><html><head><link rel="stylesheet" href="/${css}"></head><body>${marker}<script type="module" src="/${js}"></script></body></html>\n`;
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sanitize(error) {
  return error instanceof Error ? error.message : String(error);
}
