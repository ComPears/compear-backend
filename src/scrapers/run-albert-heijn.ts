import { runAlbertHeijnScraper } from './albert-heijn';

runAlbertHeijnScraper()
  .then((count) => {
    console.log('Scraped', count, 'products');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
