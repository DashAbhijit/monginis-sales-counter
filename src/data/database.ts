import * as SQLite from 'expo-sqlite';

import { DEMO_ITEMS } from '../constants/demoItems';
import type {
  BackupPayload,
  Category,
  DailyReport,
  HistorySummary,
  Item,
  ItemInput,
  ItemWithQuantity,
  ReportItem,
} from '../types';

const DATABASE_NAME = 'monginis-sales-counter.db';
const LAST_RESET_KEY = 'lastResetDate';

type ItemRow = Item & {
  deletedAt: string | null;
  quantity?: number;
};

type DailyCountRow = {
  date: string;
  itemId: string;
  quantity: number;
  updatedAt: string;
};

type DailyReportRow = {
  reportDate: string;
  totalQuantity: number;
  lineCount: number;
  createdAt: string;
};

type MetaRow = {
  key: string;
  value: string;
};

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function makeId(prefix: string) {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateLabel(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    weekday: 'short',
  });
}

export function formatPrice(price: number | null) {
  if (price === null || Number.isNaN(price)) {
    return 'No price';
  }

  return new Intl.NumberFormat(undefined, {
    currency: 'INR',
    style: 'currency',
    maximumFractionDigits: 2,
  }).format(price);
}

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price REAL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          deletedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS daily_counts (
          date TEXT NOT NULL,
          itemId TEXT NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 0,
          updatedAt TEXT NOT NULL,
          PRIMARY KEY (date, itemId),
          FOREIGN KEY (itemId) REFERENCES items(id)
        );
        CREATE TABLE IF NOT EXISTS daily_reports (
          reportDate TEXT PRIMARY KEY NOT NULL,
          totalQuantity INTEGER NOT NULL DEFAULT 0,
          lineCount INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_report_items (
          id TEXT PRIMARY KEY NOT NULL,
          reportDate TEXT NOT NULL,
          itemId TEXT,
          itemName TEXT NOT NULL,
          category TEXT NOT NULL,
          price REAL,
          quantity INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_daily_counts_date ON daily_counts (date);
        CREATE INDEX IF NOT EXISTS idx_daily_report_items_date ON daily_report_items (reportDate);
      `);
      await seedDemoItems(db);
      return db;
    });
  }

  return databasePromise;
}

async function seedDemoItems(db: SQLite.SQLiteDatabase) {
  const existing = await db.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) as total FROM items'
  );

  if ((existing?.total ?? 0) > 0) {
    return;
  }

  const createdAt = nowIso();
  await db.withTransactionAsync(async () => {
    for (const item of DEMO_ITEMS) {
      await db.runAsync(
        `
          INSERT INTO items (id, name, category, price, createdAt, updatedAt, deletedAt)
          VALUES (?, ?, ?, ?, ?, ?, NULL)
        `,
        makeId('item'),
        item.name.trim(),
        item.category,
        item.price,
        createdAt,
        createdAt
      );
    }
  });
}

async function getMetaValue(db: SQLite.SQLiteDatabase, key: string) {
  const row = await db.getFirstAsync<MetaRow>('SELECT key, value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

async function setMetaValue(db: SQLite.SQLiteDatabase, key: string, value: string) {
  await db.runAsync(
    `
      INSERT INTO meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    key,
    value
  );
}

function normalizeCategory(category: string): Category {
  const normalized = category.trim();
  const allowed: Category[] = [
    'Small Cake Items',
    'Pastries Items',
    'Non-Veg Savouries Items',
    'Veg Savouries Items',
  ];
  return allowed.includes(normalized as Category)
    ? (normalized as Category)
    : 'Small Cake Items';
}

function normalizePrice(price: number | null) {
  if (price === null || Number.isNaN(price)) {
    return null;
  }

  return Number(price.toFixed(2));
}

async function saveDailyReportSnapshot(db: SQLite.SQLiteDatabase, reportDate: string) {
  const items = await db.getAllAsync<ReportItem>(
    `
      SELECT
        dc.itemId as itemId,
        i.name as itemName,
        i.category as category,
        i.price as price,
        dc.quantity as quantity
      FROM daily_counts dc
      INNER JOIN items i ON i.id = dc.itemId
      WHERE dc.date = ? AND dc.quantity > 0
      ORDER BY i.category, i.name
    `,
    reportDate
  );

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const createdAt = nowIso();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        INSERT INTO daily_reports (reportDate, totalQuantity, lineCount, createdAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(reportDate) DO UPDATE SET
          totalQuantity = excluded.totalQuantity,
          lineCount = excluded.lineCount,
          createdAt = excluded.createdAt
      `,
      reportDate,
      totalQuantity,
      items.length,
      createdAt
    );

    await db.runAsync('DELETE FROM daily_report_items WHERE reportDate = ?', reportDate);

    for (const item of items) {
      await db.runAsync(
        `
          INSERT INTO daily_report_items (id, reportDate, itemId, itemName, category, price, quantity)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        makeId('report-item'),
        reportDate,
        item.itemId,
        item.itemName,
        item.category,
        item.price,
        item.quantity
      );
    }
  });
}

export async function ensureDailyReset() {
  const db = await getDatabase();
  const today = getLocalDateKey();
  const lastResetDate = await getMetaValue(db, LAST_RESET_KEY);

  if (!lastResetDate) {
    await setMetaValue(db, LAST_RESET_KEY, today);
    return today;
  }

  if (lastResetDate !== today) {
    await saveDailyReportSnapshot(db, lastResetDate);
    await setMetaValue(db, LAST_RESET_KEY, today);
  }

  return today;
}

export async function listActiveItems() {
  await ensureDailyReset();
  const db = await getDatabase();
  const today = getLocalDateKey();
  const rows = await db.getAllAsync<ItemRow>(
    `
      SELECT
        i.id,
        i.name,
        i.category,
        i.price,
        i.createdAt,
        i.updatedAt,
        i.deletedAt,
        COALESCE(dc.quantity, 0) as quantity
      FROM items i
      LEFT JOIN daily_counts dc ON dc.itemId = i.id AND dc.date = ?
      WHERE i.deletedAt IS NULL
      ORDER BY i.category, i.name
    `,
    today
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: normalizeCategory(row.category),
    price: row.price,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    quantity: row.quantity ?? 0,
  })) as ItemWithQuantity[];
}

export async function createItem(input: ItemInput) {
  await ensureDailyReset();
  const db = await getDatabase();
  const timestamp = nowIso();

  await db.runAsync(
    `
      INSERT INTO items (id, name, category, price, createdAt, updatedAt, deletedAt)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `,
    makeId('item'),
    input.name.trim(),
    normalizeCategory(input.category),
    normalizePrice(input.price),
    timestamp,
    timestamp
  );
}

export async function updateItem(itemId: string, input: ItemInput) {
  const db = await getDatabase();

  await db.runAsync(
    `
      UPDATE items
      SET name = ?, category = ?, price = ?, updatedAt = ?
      WHERE id = ?
    `,
    input.name.trim(),
    normalizeCategory(input.category),
    normalizePrice(input.price),
    nowIso(),
    itemId
  );
}

export async function deleteItem(itemId: string) {
  const db = await getDatabase();
  const timestamp = nowIso();

  await db.runAsync(
    `
      UPDATE items
      SET deletedAt = ?, updatedAt = ?
      WHERE id = ?
    `,
    timestamp,
    timestamp,
    itemId
  );
}

export async function setItemQuantity(itemId: string, quantity: number) {
  await ensureDailyReset();
  const db = await getDatabase();
  const today = getLocalDateKey();
  const safeQuantity = Math.max(0, Math.floor(quantity));

  await db.runAsync(
    `
      INSERT INTO daily_counts (date, itemId, quantity, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(date, itemId) DO UPDATE SET
        quantity = excluded.quantity,
        updatedAt = excluded.updatedAt
    `,
    today,
    itemId,
    safeQuantity,
    nowIso()
  );
}

export async function getTodayReport(): Promise<DailyReport> {
  await ensureDailyReset();
  const db = await getDatabase();
  const reportDate = getLocalDateKey();
  const items = await db.getAllAsync<ReportItem>(
    `
      SELECT
        dc.itemId as itemId,
        i.name as itemName,
        i.category as category,
        i.price as price,
        dc.quantity as quantity
      FROM daily_counts dc
      INNER JOIN items i ON i.id = dc.itemId
      WHERE dc.date = ? AND dc.quantity > 0
      ORDER BY i.category, i.name
    `,
    reportDate
  );

  return {
    reportDate,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    lineCount: items.length,
    items: items.map((item) => ({
      ...item,
      category: normalizeCategory(item.category),
    })),
  };
}

export async function getHistorySummaries() {
  const db = await getDatabase();
  const rows = await db.getAllAsync<DailyReportRow>(
    `
      SELECT reportDate, totalQuantity, lineCount, createdAt
      FROM daily_reports
      ORDER BY reportDate DESC
    `
  );

  return rows.map((row) => ({
    reportDate: row.reportDate,
    totalQuantity: row.totalQuantity,
    lineCount: row.lineCount,
  })) as HistorySummary[];
}

export async function getHistoryReport(reportDate: string): Promise<DailyReport> {
  const db = await getDatabase();
  const summary = await db.getFirstAsync<DailyReportRow>(
    `
      SELECT reportDate, totalQuantity, lineCount, createdAt
      FROM daily_reports
      WHERE reportDate = ?
    `,
    reportDate
  );
  const items = await db.getAllAsync<ReportItem>(
    `
      SELECT itemId, itemName, category, price, quantity
      FROM daily_report_items
      WHERE reportDate = ?
      ORDER BY category, itemName
    `,
    reportDate
  );

  return {
    reportDate,
    totalQuantity: summary?.totalQuantity ?? 0,
    lineCount: summary?.lineCount ?? items.length,
    items: items.map((item) => ({
      ...item,
      category: normalizeCategory(item.category),
    })),
  };
}

export async function exportBackupData(): Promise<BackupPayload> {
  await ensureDailyReset();
  const db = await getDatabase();
  const [items, dailyCounts, dailyReports, dailyReportItems, meta] = await Promise.all([
    db.getAllAsync<ItemRow>(
      `
        SELECT id, name, category, price, createdAt, updatedAt, deletedAt
        FROM items
        ORDER BY category, name
      `
    ),
    db.getAllAsync<DailyCountRow>(
      `
        SELECT date, itemId, quantity, updatedAt
        FROM daily_counts
        ORDER BY date DESC
      `
    ),
    db.getAllAsync<DailyReportRow>(
      `
        SELECT reportDate, totalQuantity, lineCount, createdAt
        FROM daily_reports
        ORDER BY reportDate DESC
      `
    ),
    db.getAllAsync<BackupPayload['dailyReportItems'][number]>(
      `
        SELECT id, reportDate, itemId, itemName, category, price, quantity
        FROM daily_report_items
        ORDER BY reportDate DESC, category, itemName
      `
    ),
    db.getAllAsync<MetaRow>('SELECT key, value FROM meta ORDER BY key'),
  ]);

  return {
    version: 1,
    exportedAt: nowIso(),
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      category: normalizeCategory(item.category),
      price: item.price,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      deletedAt: item.deletedAt,
    })),
    dailyCounts,
    dailyReports,
    dailyReportItems: dailyReportItems.map((item) => ({
      ...item,
      category: normalizeCategory(item.category),
    })),
    meta,
  };
}

function isValidBackupPayload(payload: unknown): payload is BackupPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    typeof record.version === 'number' &&
    Array.isArray(record.items) &&
    Array.isArray(record.dailyCounts) &&
    Array.isArray(record.dailyReports) &&
    Array.isArray(record.dailyReportItems) &&
    Array.isArray(record.meta)
  );
}

export async function restoreBackupData(payload: unknown) {
  if (!isValidBackupPayload(payload)) {
    throw new Error('Invalid backup file.');
  }

  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      DELETE FROM daily_report_items;
      DELETE FROM daily_reports;
      DELETE FROM daily_counts;
      DELETE FROM items;
      DELETE FROM meta;
    `);

    for (const item of payload.items) {
      await db.runAsync(
        `
          INSERT INTO items (id, name, category, price, createdAt, updatedAt, deletedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        item.id,
        item.name,
        normalizeCategory(item.category),
        normalizePrice(item.price),
        item.createdAt,
        item.updatedAt,
        item.deletedAt
      );
    }

    for (const row of payload.dailyCounts) {
      await db.runAsync(
        `
          INSERT INTO daily_counts (date, itemId, quantity, updatedAt)
          VALUES (?, ?, ?, ?)
        `,
        row.date,
        row.itemId,
        Math.max(0, Math.floor(row.quantity)),
        row.updatedAt
      );
    }

    for (const report of payload.dailyReports) {
      await db.runAsync(
        `
          INSERT INTO daily_reports (reportDate, totalQuantity, lineCount, createdAt)
          VALUES (?, ?, ?, ?)
        `,
        report.reportDate,
        Math.max(0, Math.floor(report.totalQuantity)),
        Math.max(0, Math.floor(report.lineCount)),
        report.createdAt
      );
    }

    for (const item of payload.dailyReportItems) {
      await db.runAsync(
        `
          INSERT INTO daily_report_items (id, reportDate, itemId, itemName, category, price, quantity)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        item.id,
        item.reportDate,
        item.itemId,
        item.itemName,
        normalizeCategory(item.category),
        normalizePrice(item.price),
        Math.max(0, Math.floor(item.quantity))
      );
    }

    for (const meta of payload.meta) {
      await db.runAsync(
        `
          INSERT INTO meta (key, value)
          VALUES (?, ?)
        `,
        meta.key,
        meta.value
      );
    }
  });

  await ensureDailyReset();
}

export function buildReportText(report: DailyReport) {
  const lines = [
    `Monginis Sales Report - ${formatDateLabel(report.reportDate)}`,
    '',
    ...report.items.map(
      (item) => `${item.itemName} (${item.category}) - ${item.quantity}`
    ),
    '',
    `Total items sold: ${report.totalQuantity}`,
  ];

  return lines.join('\n');
}
