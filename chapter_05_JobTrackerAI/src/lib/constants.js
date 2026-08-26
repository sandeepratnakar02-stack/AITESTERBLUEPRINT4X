// Kanban column definitions. `id` doubles as the job status value.
export const COLUMNS = [
  { id: 'wishlist', title: 'Wishlist', color: '#64748b', hint: 'Saved, not applied yet' },
  { id: 'applied', title: 'Applied', color: '#3b82f6', hint: 'Application submitted' },
  { id: 'followup', title: 'Follow-up', color: '#8b5cf6', hint: 'Chased recruiter / referral' },
  { id: 'interview', title: 'Interview', color: '#f59e0b', hint: 'In interview rounds' },
  { id: 'offer', title: 'Offer', color: '#22c55e', hint: 'Received an offer' },
  { id: 'rejected', title: 'Rejected', color: '#ef4444', hint: 'Got a rejection' },
];

// Fast lookup: status id -> column metadata
export const STATUS_META = Object.fromEntries(COLUMNS.map((c) => [c.id, c]));

// Ordered list of valid statuses
export const STATUS_ORDER = COLUMNS.map((c) => c.id);

// Suggested resume names for the "Resume used" dropdown (free text is allowed).
// Existing resume names from saved jobs are appended at runtime.
export const RESUME_PRESETS = [
  'SDE_Resume_v3',
  'QA_Lead_Resume',
  'QA_Automation_Resume',
  'QA_Resume_Master',
];
