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
export type PublicSharedList = Omit<SharedList, 'editToken'>;

const LISTS_DIR = path.join(__dirname, '../data/lists');
const LIST_TTL_DAYS = 30;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{6,12}$/;
const LIST_FILE_PATTERN = /^[A-Za-z0-9_-]{6,12}\.json$/;

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

function newListPath(id: string): string {
  if (!SHARE_ID_PATTERN.test(id)) {
    throw new Error('Invalid generated share id');
  }
  return path.join(LISTS_DIR, `${id}.json`);
}

/** Resolve only a filename returned by the list directory itself. */
function existingListPath(id: string): string | null {
  if (!SHARE_ID_PATTERN.test(id)) return null;
  ensureListsDir();
  const expected = `${id}.json`;
  const storedName = fs
    .readdirSync(LISTS_DIR)
    .find((candidate) => LIST_FILE_PATTERN.test(candidate) && candidate === expected);
  return storedName ? path.join(LISTS_DIR, storedName) : null;
}

export function toPublicSharedList(list: SharedList): PublicSharedList {
  const { editToken, ...publicList } = list;
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

  fs.writeFileSync(newListPath(list.id), JSON.stringify(list, null, 2), 'utf8');
  return list;
}

export function getSharedList(id: string): SharedList | null {
  const file = existingListPath(id);
  if (!file) return null;
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8')) as SharedList;
    if (new Date(list.expiresAt) < new Date()) {
      fs.unlinkSync(file);
      return null;
    }
    // Legacy lists remain readable, but cannot be modified without credentials.
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
  if (!expected) return false;
  if (!candidate) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(candidate, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Persist list updates. Legacy lists without credentials are read-only.
 */
export function updateSharedList(id: string, name: string, items: SharedListItem[]): SharedList | null {
  const existing = getSharedList(id);
  if (!existing || !existing.editToken) return null;
  const file = existingListPath(id);
  if (!file) return null;
  const updated: SharedList = {
    ...existing,
    name: name.trim() || existing.name,
    items: items.filter((i) => i.quantity > 0),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}
