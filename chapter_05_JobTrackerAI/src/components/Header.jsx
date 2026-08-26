import { useRef } from 'react';
import Icon from './Icons';
import { btnGhost, btnPrimary } from '../lib/ui';

export default function Header({ dark, onToggleDark, onAdd, jobs, onImport }) {
  const fileRef = useRef(null);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ app: 'JobTrackerAI', exportedAt: new Date().toISOString(), jobs }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'job-tracker-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const arr = Array.isArray(data) ? data : data.jobs;
        if (!Array.isArray(arr)) throw new Error('bad shape');
        onImport(arr);
      } catch {
        window.alert('Could not parse that JSON file. Expected a JobTrackerAI backup.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
      <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm">
            <Icon name="briefcase" className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">
              JobTracker<span className="text-indigo-500">AI</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Local-first kanban for your applications
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button className={btnGhost} onClick={handleExport} title="Export all jobs as JSON">
            <Icon name="download" className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button className={btnGhost} onClick={() => fileRef.current?.click()} title="Import JSON backup">
            <Icon name="upload" className="h-4 w-4" />
            <span className="hidden sm:inline">Import</span>
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFile} />
          <button className={btnGhost} onClick={onToggleDark} title="Toggle light / dark mode">
            <Icon name={dark ? 'sun' : 'moon'} className="h-4 w-4" />
          </button>
          <button className={btnPrimary} onClick={onAdd}>
            <Icon name="plus" className="h-4 w-4" />
            Add Job
          </button>
        </div>
      </div>
    </header>
  );
}
