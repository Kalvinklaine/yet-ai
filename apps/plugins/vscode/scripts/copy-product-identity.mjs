import fs from "node:fs";
import path from "node:path";

const extensionRoot = process.cwd();
const repoRoot = path.resolve(extensionRoot, "..", "..", "..");
const source = path.join(repoRoot, "product", "identity.json");
const target = path.join(extensionRoot, "out", "product", "identity.json");

const raw = fs.readFileSync(source, "utf8");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, raw);

console.log(`Copied product identity to ${path.relative(extensionRoot, target)}`);
