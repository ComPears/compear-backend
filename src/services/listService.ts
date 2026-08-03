import * as fs from 'fs';
import * as path from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';

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
  /** Secret required for PATCH; persisted but stripped from public GET responses. */
  editToken: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

/** Shared list fields safe to return to anonymous readers. */
export type PublicSharedList = Omit<SharedList, 'editToken'> & {
  /** True when the list has no editToken yet and can be claimed on first PATCH. */
  claimable?: boolean;
};

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

function generateEditToken(): string {
  return randomBytes(24).toString('base64url');
}

function listPath(id: string): string {
  return path.join(LISTS_DIR, `${id}.json`);
}

export function toPublicSharedList(list: SharedList): PublicSharedList {
  const { editToken, ...publicList } = list;
  if (!editToken) {
    return { ...publicList, claimable: true };
  }
  return publicList;
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
    editToken: generateEditToken(),
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
    // Legacy lists created before edit tokens: empty until claimed on first successful PATCH.
    if (typeof list.editToken !== 'string') {
      list.editToken = '';
    }
    return list;
  } catch {
    return null;
  }
}

export function verifyListEditToken(list: SharedList, provided: string | undefined | null): boolean {
  const expected = list.editToken || '';
  const candidate = (provided || '').trim();
  // Legacy lists (no token yet): allow a one-time claim on PATCH without a prior token.
  if (!expected) return true;
  if (!candidate) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(candidate, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Persist list updates. If the list had no editToken (legacy), mint one so the
 * PATCH response can return it to the first editor.
 */
export function updateSharedList(id: string, name: string, items: SharedListItem[]): SharedList | null {
  const existing = getSharedList(id);
  if (!existing) return null;
  const editToken = existing.editToken || generateEditToken();
  const updated: SharedList = {
    ...existing,
    name: name.trim() || existing.name,
    items: items.filter((i) => i.quantity > 0),
    editToken,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(listPath(id), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}
