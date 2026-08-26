import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import Icon from './Icons';
import { daysSince, normalizeUrl } from '../lib/format';

export default function JobCard({ job, color, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.id });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const url = normalizeUrl(job.linkedinUrl);

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderLeft: `3px solid ${color}` }}
      {...attributes}
      {...listeners}
      onClick={() => onEdit(job)}
      className={`group cursor-grab touch-manipulation rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing dark:border-slate-700 dark:bg-slate-800 ${
        isDragging ? 'z-10 rotate-1 opacity-80 shadow-xl' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{job.company}</h3>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{job.role}</p>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open LinkedIn job posting"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-700 dark:hover:text-sky-400"
          >
            <Icon name="linkedin" className="h-4 w-4" />
          </a>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {job.resume && (
          <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            📄 {job.resume}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 dark:text-slate-500">
          <Icon name="calendar" className="h-3 w-3" />
          {daysSince(job.dateApplied)}
        </span>
      </div>

      {job.salary && (
        <p className="mt-2 truncate text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{job.salary}</p>
      )}

      {/* Hover actions */}
      <div className="mt-2 flex justify-end gap-1 border-t border-slate-100 pt-1.5 opacity-0 transition-opacity group-hover:opacity-100 dark:border-slate-700">
        <button
          title="Edit"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(job);
          }}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-700 dark:hover:text-indigo-400"
        >
          <Icon name="edit" className="h-3.5 w-3.5" />
        </button>
        <button
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(job);
          }}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/40 dark:hover:text-rose-400"
        >
          <Icon name="trash" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
