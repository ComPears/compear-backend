/**
 * Seed backend product JSON from compears-data-wrangling structured files.
 * Run from backend dir: npm run seed
 */
import { seedAllStoresFromWrangling, SeedReport } from '../services/seedService';

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((100 * n) / total)}%`;
}

function formatStoreLine(report: SeedReport): string {
  const barcodePart =
    report.seeded > 0
      ? `, barcodes: ${report.seededWithBarcode}/${report.seeded} seeded (${pct(report.seededWithBarcode, report.seeded)}), source: ${report.withBarcodeInSource}/${report.totalRows}`
      : `, barcodes in source: ${report.withBarcodeInSource}/${report.totalRows}`;
  return (
    `- ${report.store}: ${report.seeded}/${report.totalRows} seeded` +
    ` (skipped price: ${report.skippedInvalidPrice}, promos: ${report.withPromo}, missing URL: ${report.missingUrl}${barcodePart})`
  );
}

function main(): void {
  const reports = seedAllStoresFromWrangling();

  const totalSeeded = reports.reduce((sum, r) => sum + r.seeded, 0);
  const totalBarcodes = reports.reduce((sum, r) => sum + r.seededWithBarcode, 0);
  const totalSourceBarcodes = reports.reduce((sum, r) => sum + r.withBarcodeInSource, 0);
  const totalSourceRows = reports.reduce((sum, r) => sum + r.totalRows, 0);

  console.log('\nSeed report:');
  for (const report of reports) {
    console.log(formatStoreLine(report));
  }

  console.log('\nBarcode summary (seeded products):');
  for (const report of reports) {
    if (report.seeded === 0) continue;
    console.log(
      `  ${report.store.padEnd(14)} ${String(report.seededWithBarcode).padStart(6)} / ${String(report.seeded).padStart(6)}  (${pct(report.seededWithBarcode, report.seeded).padStart(4)})`
    );
  }
  console.log(
    `  ${'TOTAL'.padEnd(14)} ${String(totalBarcodes).padStart(6)} / ${String(totalSeeded).padStart(6)}  (${pct(totalBarcodes, totalSeeded).padStart(4)})`
  );
  console.log(
    `\nWrangling source barcodes: ${totalSourceBarcodes}/${totalSourceRows} rows (${pct(totalSourceBarcodes, totalSourceRows)})`
  );
}

main();
