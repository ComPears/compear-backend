import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

export interface SharedListItem {
  productId: string;
  productName: string;
  store: string;
  quantity: number;
  effectivePrice: number;
}

export interface SharedList {
  id: string;
  name: string;
  items: SharedListItem[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

const LISTS_DIR = path.join(__dirname, '../data/lists');
const LIST_TTL_DAYS = 30;

function ensureListsDir(): void {
  if (!fs.existsSync(LISTS_DIR)) {
    fs.mkdirSync(LISTS_DIR, { recursive: true });
  }
}

function generateShareId(): string {
  return randomBytes(5).toString('base64url').slice(0, 8);
}

function listPath(id: string): string {
  return path.join(LISTS_DIR, `${id}.json`);
}

export function createSharedList(name: string, items: SharedListItem[]): SharedList {
  ensureListsDir();
  const now = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + LIST_TTL_DAYS);

  const list: SharedList = {
    id: generateShareId(),
    name: name.trim() || 'Shared shopping list',
    items: items.filter((i) => i.quantity > 0),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };

  fs.writeFileSync(listPath(list.id), JSON.stringify(list, null, 2), 'utf8');
  return list;
}

export function getSharedList(id: string): SharedList | null {
  const file = listPath(id);
  if (!fs.existsSync(file)) return null;
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8')) as SharedList;
    if (new Date(list.expiresAt) < new Date()) {
      fs.unlinkSync(file);
      return null;
    }
    return list;
  } catch {
    return null;
  }
}

export function updateSharedList(id: string, name: string, items: SharedListItem[]): SharedList | null {
  const existing = getSharedList(id);
  if (!existing) return null;
  const updated: SharedList = {
    ...existing,
    name: name.trim() || existing.name,
    items: items.filter((i) => i.quantity > 0),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(listPath(id), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}
