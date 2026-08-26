import { useCallback, useEffect, useState } from 'react';
import { addJob, deleteJob, getAllJobs, replaceAllJobs, updateJob } from '../lib/db';
import { STATUS_ORDER } from '../lib/constants';
import { todayISO } from '../lib/format';

// Normalizes arbitrary records (from an import file) into the app's shape.
function normalizeRecord(r) {
  return {
    id: r.id || crypto.randomUUID(),
    company: typeof r.company === 'string' ? r.company : '',
    role: typeof r.role === 'string' ? r.role : '',
    linkedinUrl: typeof r.linkedinUrl === 'string' ? r.linkedinUrl : '',
    resume: typeof r.resume === 'string' ? r.resume : '',
    dateApplied: r.dateApplied || todayISO(),
    salary: typeof r.salary === 'string' ? r.salary : '',
    notes: typeof r.notes === 'string' ? r.notes : '',
    status: STATUS_ORDER.includes(r.status) ? r.status : 'wishlist',
    createdAt: r.createdAt || Date.now(),
    updatedAt: r.updatedAt || Date.now(),
  };
}

export function useJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getAllJobs()
      .then((data) => {
        if (alive) setJobs(data);
      })
      .catch((err) => {
        console.error('Failed to load jobs from IndexedDB', err);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const createJob = useCallback(async (job) => {
    const record = {
      ...job,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addJob(record);
    setJobs((prev) => [record, ...prev]);
    return record;
  }, []);

  const saveJob = useCallback(async (job) => {
    const record = { ...job, updatedAt: Date.now() };
    await updateJob(record);
    setJobs((prev) => prev.map((j) => (j.id === record.id ? record : j)));
    return record;
  }, []);

  const removeJob = useCallback(async (id) => {
    await deleteJob(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const moveJob = useCallback(
    async (id, status) => {
      const current = jobs.find((j) => j.id === id);
      if (!current || current.status === status) return;
      const record = { ...current, status, updatedAt: Date.now() };
      await updateJob(record);
      setJobs((prev) => prev.map((j) => (j.id === id ? record : j)));
    },
    [jobs]
  );

  const importAll = useCallback(async (records) => {
    const normalized = records.map(normalizeRecord);
    const count = await replaceAllJobs(normalized);
    setJobs(normalized);
    return count;
  }, []);

  return { jobs, loading, createJob, saveJob, removeJob, moveJob, importAll };
}
