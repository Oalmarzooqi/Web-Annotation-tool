"use client";

type StoredVolume = {
  projectId: string;
  name: string;
  type: string;
  blob: Blob;
  savedAt: number;
};

const DB_NAME = "oct-annotator";
const DB_VERSION = 1;
const STORE = "projectVolumes";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "projectId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export async function getProjectVolume(projectId: string): Promise<StoredVolume | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const res = await requestToPromise<StoredVolume | undefined>(store.get(projectId));
    return res ?? null;
  } finally {
    db.close();
  }
}

export async function setProjectVolume(input: {
  projectId: string;
  name: string;
  type: string;
  blob: Blob;
}): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    await requestToPromise(store.put({ ...input, savedAt: Date.now() } satisfies StoredVolume));
  } finally {
    db.close();
  }
}

export async function deleteProjectVolume(projectId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    await requestToPromise(store.delete(projectId));
  } finally {
    db.close();
  }
}

