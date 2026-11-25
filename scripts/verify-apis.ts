import { verifyCatalogue } from "../src/lib/capabilities";

const report = await verifyCatalogue();
console.log(`Verified ${report.checkedAt} (probe geography ${report.probeGeography})\n`);
for (const [id, h] of Object.entries(report.services)) console.log(`${id.padEnd(10)} ${h.state.padEnd(15)} ${h.detail}`);
console.log("");
for (const [id, v] of Object.entries(report.indicators).sort()) console.log(`${v.state.padEnd(6)} ${id.padEnd(44)} ${v.first ?? "-"}–${v.latest ?? "-"}  updated ${v.providerUpdated ?? "n/a"}${v.state === "failed" ? "  " + v.detail : ""}`);
