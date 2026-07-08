/**
 * Seed backend product JSON from compears-data-wrangling structured files.
 * Run from backend dir: npm run seed
 */
import { seedAllStoresFromWrangling } from '../services/seedService';

function main(): void {
  const reports = seedAllStoresFromWrangling();

  console.log('\nSeed report:');
  for (const report of reports) {
    console.log(
      `- ${report.store}: ${report.seeded}/${report.totalRows} seeded` +
        ` (skipped price: ${report.skippedInvalidPrice}, promos: ${report.withPromo}, missing URL: ${report.missingUrl})`
    );
  }
}

main();
