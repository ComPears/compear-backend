import { Request, Response } from 'express';
import { getProductsByCanonicalName } from '../services/productMatcher';

export function compareByCanonicalName(req: Request, res: Response): void {
  try {
    const canonicalName = decodeURIComponent(req.params.canonicalName || '');
    if (!canonicalName) {
      res.status(400).json({ error: 'canonicalName required' });
      return;
    }
    const products = getProductsByCanonicalName(canonicalName);
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
