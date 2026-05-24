import fs from "node:fs";
import path from "node:path";

const extensionRoot = process.cwd();
const repoRoot = path.resolve(extensionRoot, "..", "..", "..");
const source = path.join(repoRoot, "apps", "gui", "dist");
const target = path.join(extensionRoot, "media", "gui");
const indexPath = path.join(source, "index.html");

if (!fs.existsSync(indexPath)) {
  throw new Error("GUI dist is missing. Run `cd apps/gui && npm run build` before copying assets.");
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });
console.log(`Copied GUI dist to ${path.relative(extensionRoot, target)}`);
