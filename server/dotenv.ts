import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function load(pathname: string, override: boolean) {
  const full = resolve(process.cwd(), pathname);
  if (!existsSync(full)) return;
  config({ path: full, override });
}

// Load base env first, then let .env.local override (Next.js convention).
load(".env", false);
load(".env.local", true);

