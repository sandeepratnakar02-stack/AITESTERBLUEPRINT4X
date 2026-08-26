import Icon from './Icons';
import { btnDanger, btnGhost } from '../lib/ui';

export default function ConfirmDialog({ job, onCancel, onConfirm }) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400">
          <Icon name="trash" className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Delete job?</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{job.company}</span> — {job.role} will be
          permanently removed. This can't be undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button className={btnGhost} onClick={onCancel}>
            Cancel
          </button>
          <button className={btnDanger} onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
