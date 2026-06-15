import { chmod } from "node:fs/promises";
import path from "node:path";

await chmod(path.resolve("dist", "cli.js"), 0o755);
