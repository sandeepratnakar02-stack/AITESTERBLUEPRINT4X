import { useEffect, useState } from 'react';
import Icon from './Icons';
import { COLUMNS } from '../lib/constants';
import { todayISO } from '../lib/format';
import { btnGhost, btnPrimary, errorCls, inputCls, labelCls } from '../lib/ui';

const EMPTY = {
  company: '',
  role: '',
  linkedinUrl: '',
  resume: '',
  dateApplied: todayISO(),
  salary: '',
  notes: '',
  status: 'wishlist',
};

export default function JobFormModal({ mode, job, resumes, onClose, onSave }) {
  const [form, setForm] = useState(() => (mode === 'edit' && job ? { ...EMPTY, ...job } : EMPTY));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const isEdit = mode === 'edit';

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.company.trim()) errs.company = 'Company name is required';
    if (!form.role.trim()) errs.role = 'Job title / role is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    try {
      await onSave({
        ...form,
        company: form.company.trim(),
        role: form.role.trim(),
        linkedinUrl: form.linkedinUrl.trim(),
        resume: form.resume.trim(),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800"
        onMouseDown={(e) => e.stopPropagation()}
        noValidate
      >
        <header className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {isEdit ? 'Edit Job' : 'Add New Job'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Close"
          >
            <Icon name="x" className="h-5 w-5" />
          </button>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Company *" error={errors.company}>
            <input
              autoFocus
              value={form.company}
              onChange={set('company')}
              placeholder="e.g. Acme Corp"
              className={inputCls}
            />
          </Field>

          <Field label="Job title / role *" error={errors.role}>
            <input value={form.role} onChange={set('role')} placeholder="e.g. QA Automation Engineer" className={inputCls} />
          </Field>

          <div className="sm:col-span-2">
            <Field label="LinkedIn job URL">
              <input
                type="url"
                value={form.linkedinUrl}
                onChange={set('linkedinUrl')}
                placeholder="https://www.linkedin.com/jobs/view/…"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Resume used">
            <input
              list="resume-options"
              value={form.resume}
              onChange={set('resume')}
              placeholder="e.g. QA_Automation_Resume"
              className={inputCls}
            />
            <datalist id="resume-options">
              {resumes.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>

          <Field label="Date applied">
            <input type="date" value={form.dateApplied} onChange={set('dateApplied')} className={inputCls} />
          </Field>

          <Field label="Salary range">
            <input value={form.salary} onChange={set('salary')} placeholder="e.g. ₹25-30 LPA" className={inputCls} />
          </Field>

          <Field label="Status">
            <select value={form.status} onChange={set('status')} className={inputCls}>
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="Notes">
              <textarea
                value={form.notes}
                onChange={set('notes')}
                rows={3}
                placeholder="Recruiter name, referral info, next steps…"
                className={inputCls}
              />
            </Field>
          </div>
        </div>

        <footer className="mt-6 flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={submitting}>
            {isEdit ? 'Save changes' : 'Add job'}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
      {error && <p className={errorCls}>{error}</p>}
    </div>
  );
}
