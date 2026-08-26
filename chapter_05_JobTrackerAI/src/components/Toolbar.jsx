import Icon from './Icons';
import { COLUMNS } from '../lib/constants';
import { inputCls, btnGhost } from '../lib/ui';

export default function Toolbar({ query, onQuery, sortDir, onSort, statusFilter, onStatusFilter, counts }) {
  return (
    <div className="mx-auto max-w-[1700px] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative min-w-[200px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search by company or role…"
            className={`${inputCls} pl-9`}
          />
        </div>

        {/* Status filter pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill active={statusFilter === 'all'} onClick={() => onStatusFilter('all')} label="All" count={counts.all} />
          {COLUMNS.map((c) => (
            <FilterPill
              key={c.id}
              active={statusFilter === c.id}
              onClick={() => onStatusFilter(c.id)}
              label={c.title}
              count={counts[c.id]}
              color={c.color}
            />
          ))}
        </div>

        {/* Sort within column */}
        <button className={btnGhost} onClick={() => onSort(sortDir === 'newest' ? 'oldest' : 'newest')} title="Sort cards by date">
          <Icon name={sortDir === 'newest' ? 'arrowDown' : 'arrowUp'} className="h-4 w-4" />
          {sortDir === 'newest' ? 'Newest first' : 'Oldest first'}
        </button>
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, label, count, color }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-indigo-500 bg-indigo-600 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
      }`}
    >
      {color && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: active ? '#fff' : color }}
          aria-hidden="true"
        />
      )}
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${active ? 'bg-white/25' : 'bg-slate-100 dark:bg-slate-700'}`}>
        {count ?? 0}
      </span>
    </button>
  );
}
