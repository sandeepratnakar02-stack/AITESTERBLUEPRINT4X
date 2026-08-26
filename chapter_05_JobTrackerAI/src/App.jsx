import { useMemo, useState } from 'react';
import { useJobs } from './hooks/useJobs';
import { useDarkMode } from './hooks/useDarkMode';
import Header from './components/Header';
import Toolbar from './components/Toolbar';
import KanbanBoard from './components/KanbanBoard';
import JobFormModal from './components/JobFormModal';
import ConfirmDialog from './components/ConfirmDialog';
import Toast from './components/Toast';
import Icon from './components/Icons';
import { COLUMNS, RESUME_PRESETS, STATUS_META } from './lib/constants';
import { btnPrimary } from './lib/ui';

export default function App() {
  const { jobs, loading, createJob, saveJob, removeJob, moveJob, importAll } = useJobs();
  const { dark, toggle } = useDarkMode();

  const [query, setQuery] = useState('');
  const [sortDir, setSortDir] = useState('newest');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modal, setModal] = useState(null); // { mode: 'create' } | { mode: 'edit', job }
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);

  // Distinct resume names = presets + anything already used on saved jobs.
  const resumes = useMemo(() => {
    const used = new Set(jobs.map((j) => j.resume).filter(Boolean));
    return [...new Set([...RESUME_PRESETS, ...used])];
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false;
      if (!q) return true;
      return j.company.toLowerCase().includes(q) || j.role.toLowerCase().includes(q);
    });
  }, [jobs, query, statusFilter]);

  const counts = useMemo(() => {
    const c = { all: jobs.length };
    for (const col of COLUMNS) c[col.id] = 0;
    for (const j of jobs) c[j.status] = (c[j.status] || 0) + 1;
    return c;
  }, [jobs]);

  const showToast = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  const handleCreate = async (data) => {
    await createJob(data);
    showToast(`Added ${data.company} → ${STATUS_META[data.status].title}`);
  };

  const handleUpdate = async (data) => {
    await saveJob(data);
    showToast('Job updated');
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { company } = deleteTarget;
    await removeJob(deleteTarget.id);
    setDeleteTarget(null);
    showToast(`Deleted ${company}`);
  };

  const handleImport = async (records) => {
    const n = await importAll(records);
    showToast(`Imported ${n} job${n === 1 ? '' : 's'}`);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <Header dark={dark} onToggleDark={toggle} onAdd={() => setModal({ mode: 'create' })} jobs={jobs} onImport={handleImport} />

      {jobs.length > 0 && (
        <Toolbar
          query={query}
          onQuery={setQuery}
          sortDir={sortDir}
          onSort={setSortDir}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          counts={counts}
        />
      )}

      <main className="mx-auto max-w-[1700px] px-4">
        {loading ? (
          <div className="flex gap-4 overflow-x-auto pb-6">
            {COLUMNS.map((c) => (
              <div key={c.id} className="h-72 w-72 shrink-0 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState onAdd={() => setModal({ mode: 'create' })} />
        ) : (
          <KanbanBoard
            jobs={filteredJobs}
            onMove={moveJob}
            onEdit={(job) => setModal({ mode: 'edit', job })}
            onDelete={setDeleteTarget}
            sortDir={sortDir}
          />
        )}
      </main>

      {modal && (
        <JobFormModal
          mode={modal.mode}
          job={modal.mode === 'edit' ? modal.job : null}
          resumes={resumes}
          onClose={() => setModal(null)}
          onSave={modal.mode === 'create' ? handleCreate : handleUpdate}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog job={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={handleDelete} />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg">
          <Icon name="briefcase" className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Track your job hunt in one place</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Save jobs to your Wishlist, then drag them through Applied → Follow-up → Interview → Offer as you progress.
          Everything is stored locally in your browser.
        </p>
        <button className={`${btnPrimary} mt-6`} onClick={onAdd}>
          <Icon name="plus" className="h-4 w-4" />
          Add your first job
        </button>
      </div>
    </div>
  );
}
