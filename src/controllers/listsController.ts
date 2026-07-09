import { Request, Response } from 'express';
import { createSharedList, getSharedList, updateSharedList, SharedListItem } from '../services/listService';

function parseItems(body: unknown): SharedListItem[] | null {
  if (!Array.isArray(body)) return null;
  const items: SharedListItem[] = [];
  for (const raw of body) {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as SharedListItem).productId !== 'string' ||
      typeof (raw as SharedListItem).productName !== 'string' ||
      typeof (raw as SharedListItem).store !== 'string' ||
      typeof (raw as SharedListItem).quantity !== 'number' ||
      typeof (raw as SharedListItem).effectivePrice !== 'number'
    ) {
      return null;
    }
    items.push({
      productId: (raw as SharedListItem).productId,
      productName: (raw as SharedListItem).productName.slice(0, 200),
      store: (raw as SharedListItem).store.slice(0, 80),
      quantity: Math.min(99, Math.max(1, Math.round((raw as SharedListItem).quantity))),
      effectivePrice: Math.max(0, (raw as SharedListItem).effectivePrice),
    });
  }
  return items.slice(0, 100);
}

export function createList(req: Request, res: Response): void {
  const name = typeof req.body?.name === 'string' ? req.body.name : 'Shared shopping list';
  const items = parseItems(req.body?.items);
  if (!items) {
    res.status(400).json({ error: 'Invalid items array' });
    return;
  }
  if (items.length === 0) {
    res.status(400).json({ error: 'List must contain at least one item' });
    return;
  }
  const list = createSharedList(name, items);
  res.status(201).json(list);
}

export function getList(req: Request, res: Response): void {
  const id = (req.params.id || '').trim();
  if (!/^[A-Za-z0-9_-]{6,12}$/.test(id)) {
    res.status(400).json({ error: 'Invalid list id' });
    return;
  }
  const list = getSharedList(id);
  if (!list) {
    res.status(404).json({ error: 'List not found or expired' });
    return;
  }
  res.json(list);
}

export function patchList(req: Request, res: Response): void {
  const id = (req.params.id || '').trim();
  if (!/^[A-Za-z0-9_-]{6,12}$/.test(id)) {
    res.status(400).json({ error: 'Invalid list id' });
    return;
  }
  const name = typeof req.body?.name === 'string' ? req.body.name : undefined;
  const items = parseItems(req.body?.items);
  if (!items) {
    res.status(400).json({ error: 'Invalid items array' });
    return;
  }
  const list = updateSharedList(id, name ?? 'Shared shopping list', items);
  if (!list) {
    res.status(404).json({ error: 'List not found or expired' });
    return;
  }
  res.json(list);
}
