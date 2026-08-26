# JobTrackerAI

A **local-first** job application tracker built as a single-page React app. All data lives in your browser (IndexedDB) — no backend, no accounts, no API calls.

## Features

- **Kanban board** with 6 columns: Wishlist → Applied → Follow-up → Interview → Offer → Rejected
- **Drag & drop** cards between columns (`@dnd-kit/core`)
- **Add / edit / delete** jobs via a modal form with required-field validation
- **Card shows**: company, role, resume tag, days since applied, and a clickable LinkedIn link
- **Search & filter** by company/role, plus per-column counts
- **Instant IndexedDB persistence** (`idb`)
- **Light / dark mode** toggle (persisted)
- **Export / Import** all data as JSON for backup & restore
- **Sort** cards within a column by date (newest / oldest)

## Tech Stack

- React 18 (functional components + hooks)
- Vite
- Tailwind CSS v4
- `idb` (IndexedDB wrapper)
- `@dnd-kit/core` + `@dnd-kit/utilities`

## Getting started

```bash
npm install
npm run dev      # start dev server (http://localhost:5173)
npm run build    # production build
npm run preview  # preview the production build
```

## Project structure

```
src/
  main.jsx                 # React entry
  App.jsx                  # Root: state, search/sort/filter, modals
  index.css                # Tailwind + dark-mode variant
  lib/
    constants.js           # Kanban columns, statuses, resume presets
    db.js                  # idb wrapper (CRUD + bulk import)
    format.js              # date/salary/url helpers
    ui.js                  # shared Tailwind class strings
  hooks/
    useJobs.js             # job state + persistence
    useDarkMode.js         # theme toggle (localStorage)
  components/
    Header.jsx             # title, theme, export/import, Add Job
    Toolbar.jsx            # search, status filter, sort toggle
    KanbanBoard.jsx        # DndContext + column grid
    KanbanColumn.jsx       # droppable column w/ count + scroll
    JobCard.jsx            # draggable job card
    JobFormModal.jsx       # add/edit form with validation
    ConfirmDialog.jsx      # delete confirmation
    Toast.jsx              # small status toast
    Icons.jsx              # inline SVG icons
```
