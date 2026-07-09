import * as path from 'path';
import {
  importStoreLocationsFromOsm,
  writeStoreLocationDataset,
} from '../services/storeLocationImport';

const outputPath = path.join(__dirname, '../data/store-locations.json');

async function main(): Promise<void> {
  console.info('Fetching NL supermarket locations from OpenStreetMap…');
  const dataset = await importStoreLocationsFromOsm();
  writeStoreLocationDataset(outputPath, dataset);
  console.info(`Wrote ${dataset.count} locations to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
