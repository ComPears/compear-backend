import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { triggerScrape, getScrapeStatus } from '../controllers/scrapeController';
import { apiKeyAuth } from '../middleware/apiKeyAuth';

const scrapeRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

export const scrapeRouter = Router();
scrapeRouter.get('/status', getScrapeStatus);
scrapeRouter.post('/:store', scrapeRateLimit, apiKeyAuth, triggerScrape);
