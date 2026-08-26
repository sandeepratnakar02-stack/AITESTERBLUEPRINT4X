import { DndContext, PointerSensor, closestCorners, useSensor, useSensors } from '@dnd-kit/core';
import KanbanColumn from './KanbanColumn';
import { COLUMNS, STATUS_META } from '../lib/constants';
import { compareByDate } from '../lib/format';

export default function KanbanBoard({ jobs, onMove, onEdit, onDelete, sortDir }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = ({ active, over }) => {
    if (!over) return;
    const job = jobs.find((j) => j.id === active.id);
    if (!job) return;
    const target = over.id;
    if (target === job.status || !STATUS_META[target]) return;
    onMove(job.id, target);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="flex items-start gap-4 overflow-x-auto pb-6">
        {COLUMNS.map((col) => {
          const items = jobs.filter((j) => j.status === col.id).sort(compareByDate(sortDir));
          return (
            <KanbanColumn key={col.id} column={col} items={items} onEdit={onEdit} onDelete={onDelete} />
          );
        })}
      </div>
    </DndContext>
  );
}
