import fs from "node:fs/promises";
import path from "node:path";

const manifestPath = path.resolve("manifests/extensions.json");
const raw = await fs.readFile(manifestPath, "utf8");
const manifest = JSON.parse(raw);

if (!Array.isArray(manifest.extensions) || manifest.extensions.length === 0) {
  throw new Error("manifests/extensions.json must contain at least one extension.");
}

for (const extension of manifest.extensions) {
  if (!extension.name || !extension.manifest) {
    throw new Error("Each extension entry must include name and manifest.");
  }
}

console.log(`Validated ${manifest.extensions.length} extension entries.`);
