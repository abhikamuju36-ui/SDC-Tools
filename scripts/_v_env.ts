import { readFileSync } from "node:fs";
export function loadEnv(): void {
  for (const line of readFileSync("D:/AI Projects/Centrailized library/sdc-etc-planner/.env","utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
