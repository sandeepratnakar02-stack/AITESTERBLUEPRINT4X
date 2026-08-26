import { openDB } from 'idb';

const DB_NAME = 'job-tracker-db';
const DB_VERSION = 1;
const STORE = 'jobs';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('status', 'status');
          store.createIndex('dateApplied', 'dateApplied');
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllJobs() {
  const db = await getDB();
  return db.getAll(STORE);
}

export async function addJob(job) {
  const db = await getDB();
  await db.put(STORE, job);
  return job;
}

export async function updateJob(job) {
  const db = await getDB();
  await db.put(STORE, job);
  return job;
}

export async function deleteJob(id) {
  const db = await getDB();
  await db.delete(STORE, id);
}

// Replace the entire store (used by Import). Returns the number written.
export async function replaceAllJobs(jobs) {
  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  await tx.store.clear();
  await Promise.all(jobs.map((j) => tx.store.put(j)));
  await tx.done;
  return jobs.length;
}
