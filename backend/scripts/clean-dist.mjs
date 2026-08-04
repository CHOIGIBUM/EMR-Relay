import { readdir, rmdir, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(backendRoot, "dist");

if (distRoot !== join(backendRoot, "dist") || !distRoot.startsWith(`${backendRoot}${sep}`)) {
  throw new Error("Refusing to clean a path outside the backend workspace.");
}

async function removeGeneratedEntries(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  await Promise.all(entries.map(async (entry) => {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      await removeGeneratedEntries(target);
      try {
        await rmdir(target);
      } catch (error) {
        // Some managed Windows workspaces deny deleting the directory entry
        // while still allowing generated files to be removed. Empty folders
        // are harmless and TypeScript can reuse them.
        if (!["EACCES", "EPERM", "ENOTEMPTY"].includes(error?.code)) throw error;
      }
      return;
    }
    await unlink(target);
  }));
}

await removeGeneratedEntries(distRoot);
