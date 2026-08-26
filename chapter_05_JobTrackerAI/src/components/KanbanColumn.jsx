import { useDroppable } from '@dnd-kit/core';
import JobCard from './JobCard';
import Icon from './Icons';

export default function KanbanColumn({ column, items, onEdit, onDelete }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl border bg-slate-200/50 transition-colors dark:bg-slate-900/40 ${
        isOver ? 'border-indigo-400 ring-2 ring-indigo-300 dark:ring-indigo-500/50' : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      {/* Header */}
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: column.color }} aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{column.title}</h2>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-300">
          {items.length}
        </span>
      </header>
      <p className="px-3 pb-2 text-[10px] text-slate-400 dark:text-slate-500">{column.hint}</p>

      {/* Cards — independently scrollable */}
      <div className="kanban-scroll flex max-h-[calc(100vh-280px)] min-h-[140px] flex-col gap-2 overflow-y-auto px-2.5 pb-2.5">
        {items.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-slate-300 py-8 text-slate-400 dark:border-slate-700">
            <div className="flex flex-col items-center gap-1 text-[11px]">
              <Icon name="inbox" className="h-5 w-5" />
              <span>Drop a card here</span>
            </div>
          </div>
        ) : (
          items.map((job) => (
            <JobCard key={job.id} job={job} color={column.color} onEdit={onEdit} onDelete={onDelete} />
          ))
        )}
      </div>
    </section>
  );
}
