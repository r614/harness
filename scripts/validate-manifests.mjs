import fs from "node:fs/promises";
import path from "node:path";

const manifestPath = path.resolve("manifests/extensions.json");
const raw = await fs.readFile(manifestPath, "utf8");
const manifest = JSON.parse(raw);
const packagePath = path.resolve("package.json");
const packageRaw = await fs.readFile(packagePath, "utf8");
const packageJson = JSON.parse(packageRaw);

if (!Array.isArray(manifest.extensions) || manifest.extensions.length === 0) {
  throw new Error("manifests/extensions.json must contain at least one extension.");
}

for (const extension of manifest.extensions) {
  if (!extension.name || !extension.manifest) {
    throw new Error("Each extension entry must include name and manifest.");
  }
}

if (!Array.isArray(packageJson.keywords) || !packageJson.keywords.includes("pi-package")) {
  throw new Error('package.json must include the "pi-package" keyword.');
}

if (!packageJson.pi || !Array.isArray(packageJson.pi.extensions) || packageJson.pi.extensions.length === 0) {
  throw new Error("package.json must define a pi.extensions array.");
}

console.log(`Validated ${manifest.extensions.length} extension entries.`);
