import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  AppSettings,
  HistoryEntry,
  PackageSpec,
  Project,
} from '../types/packvol';
import { DEFAULT_PRODUCT_LIBRARY, SAMPLE_PROJECTS } from '../data/presets';

interface MKCubeDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: { 'by-updated': number };
  };
  products: {
    key: string;
    value: PackageSpec;
  };
  history: {
    key: string;
    value: HistoryEntry;
    indexes: { 'by-time': number };
  };
  settings: {
    key: string;
    value: { id: string; data: AppSettings };
  };
}

const DB_NAME = 'mkcube-pro-db';
const LEGACY_DB_NAME = 'packvol-pro-db';
const DB_VERSION = 1;

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  lengthUnit: 'mm',
  weightUnit: 'kg',
  lowPerfMode: false,
  showFloorGrid: true,
  showWalls: true,
  transparentWalls: true,
  showEmptySpaces: false,
  showPackageIds: true,
};

let dbPromise: Promise<IDBPDatabase<MKCubeDB>> | null = null;

function getDb(): Promise<IDBPDatabase<MKCubeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MKCubeDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          const pStore = db.createObjectStore('projects', { keyPath: 'id' });
          pStore.createIndex('by-updated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('history')) {
          const hStore = db.createObjectStore('history', { keyPath: 'id' });
          hStore.createIndex('by-time', 'timestamp');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

async function tryMigrateLegacyDb(db: IDBPDatabase<MKCubeDB>): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined') return false;
    if (typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === LEGACY_DB_NAME)) return false;
    }
    const legacy = await openDB<MKCubeDB>(LEGACY_DB_NAME, DB_VERSION);
    if (!legacy.objectStoreNames.contains('projects')) {
      legacy.close();
      return false;
    }
    const [oldProjects, oldProducts, oldHistory, oldSettings] = await Promise.all([
      legacy.getAll('projects'),
      legacy.objectStoreNames.contains('products') ? legacy.getAll('products') : Promise.resolve([]),
      legacy.objectStoreNames.contains('history') ? legacy.getAll('history') : Promise.resolve([]),
      legacy.objectStoreNames.contains('settings') ? legacy.get('settings', 'app') : Promise.resolve(undefined),
    ]);
    legacy.close();
    if (oldProjects.length === 0 && oldProducts.length === 0 && oldHistory.length === 0 && !oldSettings) {
      return false;
    }
    if (oldProjects.length > 0) {
      const tx = db.transaction('projects', 'readwrite');
      for (const p of oldProjects) await tx.store.put(p);
      await tx.done;
    }
    if (oldProducts.length > 0) {
      const tx = db.transaction('products', 'readwrite');
      for (const prod of oldProducts) await tx.store.put(prod);
      await tx.done;
    }
    if (oldHistory.length > 0) {
      const tx = db.transaction('history', 'readwrite');
      for (const h of oldHistory) await tx.store.put(h);
      await tx.done;
    }
    if (oldSettings) {
      await db.put('settings', oldSettings);
    }
    return true;
  } catch {
    return false;
  }
}

export async function initializeStorage(): Promise<{
  projects: Project[];
  library: PackageSpec[];
  history: HistoryEntry[];
  settings: AppSettings;
}> {
  const db = await getDb();

  let projects = await db.getAll('projects');
  if (projects.length === 0) {
    await tryMigrateLegacyDb(db);
    projects = await db.getAll('projects');
  }
  if (projects.length === 0) {
    const tx = db.transaction('projects', 'readwrite');
    for (const p of SAMPLE_PROJECTS) {
      await tx.store.put(p);
    }
    await tx.done;
    projects = [...SAMPLE_PROJECTS];
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt);

  let library = await db.getAll('products');
  if (library.length === 0) {
    const tx = db.transaction('products', 'readwrite');
    for (const prod of DEFAULT_PRODUCT_LIBRARY) {
      await tx.store.put(prod);
    }
    await tx.done;
    library = [...DEFAULT_PRODUCT_LIBRARY];
  }

  const history = await db.getAll('history');
  history.sort((a, b) => b.timestamp - a.timestamp);

  const storedSettings = await db.get('settings', 'app');
  const settings = storedSettings?.data
    ? { ...DEFAULT_SETTINGS, ...storedSettings.data }
    : { ...DEFAULT_SETTINGS };

  return { projects, library, history, settings };
}

export async function saveProjectToDb(project: Project): Promise<void> {
  const db = await getDb();
  await db.put('projects', project);
}

export async function saveManyProjectsToDb(projects: Project[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('projects', 'readwrite');
  for (const p of projects) {
    await tx.store.put(p);
  }
  await tx.done;
}

export async function replaceAllProjectsInDb(projects: Project[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('projects', 'readwrite');
  await tx.store.clear();
  for (const p of projects) {
    await tx.store.put(p);
  }
  await tx.done;
}

export async function deleteProjectFromDb(projectId: string): Promise<void> {
  const db = await getDb();
  await db.delete('projects', projectId);
}

export async function saveLibraryProductToDb(product: PackageSpec): Promise<void> {
  const db = await getDb();
  await db.put('products', product);
}

export async function deleteLibraryProductFromDb(productId: string): Promise<void> {
  const db = await getDb();
  await db.delete('products', productId);
}

export async function addHistoryEntryToDb(entry: HistoryEntry): Promise<void> {
  const db = await getDb();
  await db.put('history', entry);
}

export async function clearHistoryFromDb(): Promise<void> {
  const db = await getDb();
  await db.clear('history');
}

export async function saveSettingsToDb(settings: AppSettings): Promise<void> {
  const db = await getDb();
  await db.put('settings', { id: 'app', data: settings });
}
