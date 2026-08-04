
import {
  CountryCode,
  DEFAULT_COUNTRY,
  loadWranglingConfig,
  parseCountryCode,
} from '../config/countries';
import {
  getWranglingPath,
  seedAllStoresFromWrangling,
  SeedReport,
} from '../services/seedService';

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

function countriesToSeed(): CountryCode[] {
  const raw = process.env.COUNTRY?.trim();
  if (!raw) return [DEFAULT_COUNTRY, 'uk', 'de'];
  return raw
    .split(',')
    .map((part) => parseCountryCode(part.trim()))
    .filter((code, index, all) => all.indexOf(code) === index);
}

function main(): void {
  const countries = countriesToSeed();
  const wranglingPath = getWranglingPath();
  const config = loadWranglingConfig(wranglingPath);
  const failures: string[] = [];
  let totalSeeded = 0;
  let totalBarcodes = 0;
  let totalSourceBarcodes = 0;
  let totalSourceRows = 0;

  for (const country of countries) {
    console.log(`\n=== Seeding ${country} ===`);
    const reports = seedAllStoresFromWrangling(wranglingPath, country);

    console.log(`\nSeed report (${country}):`);
    for (const report of reports) {
      console.log(formatStoreLine(report));
    }

    totalSeeded += reports.reduce((sum, r) => sum + r.seeded, 0);
    totalBarcodes += reports.reduce((sum, r) => sum + r.seededWithBarcode, 0);
    totalSourceBarcodes += reports.reduce((sum, r) => sum + r.withBarcodeInSource, 0);
    totalSourceRows += reports.reduce((sum, r) => sum + r.totalRows, 0);

    for (const report of reports) {
      const storeCfg = config.countries[country]?.stores?.[report.store] as
        | { minimum_products?: number; optional?: boolean }
        | undefined;
      const minimum = storeCfg?.minimum_products ?? 0;
      const optional = Boolean(storeCfg?.optional);
      if (!optional && minimum > 0 && report.seeded < minimum) {
        failures.push(
          `${country}/${report.store}: ${report.seeded} seeded < minimum ${minimum}` +
            (report.totalRows === 0 ? ' (source catalog missing or empty)' : '')
        );
      }
    }
  }

  console.log(
    `\nAll countries TOTAL barcodes: ${totalBarcodes}/${totalSeeded} seeded (${pct(totalBarcodes, totalSeeded)})`
  );
  console.log(
    `Wrangling source barcodes: ${totalSourceBarcodes}/${totalSourceRows} rows (${pct(totalSourceBarcodes, totalSourceRows)})`
  );

  if (failures.length > 0) {
    console.error('\nSeed validation failed:');
    for (const msg of failures) {
      console.error(`  - ${msg}`);
    }
    process.exit(1);
  }
}

main();
