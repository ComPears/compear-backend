import { Request, Response } from 'express';
import { getComparableProducts, getProductsByIdentityKey } from '../services/productMatcher';

export function compareByCanonicalName(req: Request, res: Response): void {
  try {
    const identityKey = typeof req.query.identityKey === 'string' ? req.query.identityKey : null;
    if (identityKey) {
      res.json(getProductsByIdentityKey(identityKey));
      return;
    }

    const canonicalName = decodeURIComponent(req.params.canonicalName || '');
    if (!canonicalName) {
      res.status(400).json({ error: 'canonicalName required' });
      return;
    }
    const products = getComparableProducts(canonicalName, identityKey);
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
