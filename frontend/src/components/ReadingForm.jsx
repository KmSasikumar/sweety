import { useState } from 'react';
import { api, TIME_SLOTS, SLOT_LABELS, SLOT_SHORT, slotArticle } from '../api';

export default function ReadingForm({ initial, onSubmit, onCancel, busy }) {
  const [glucose, setGlucose] = useState(initial ? String(initial.glucose_mg_dl) : '');
  const [date, setDate] = useState(
    initial ? String(initial.reading_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [timeSlot, setTimeSlot] = useState(initial ? initial.time_slot : 'morning');
  const [notes, setNotes] = useState(initial ? initial.notes || '' : '');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  // The same Kenpath rules as the API, with the same messages, so the
  // user gets instant feedback and the server stays the final authority.
  async function handleSubmit(e) {
    e.preventDefault();
    if (glucose.trim() === '') {
      setError('Please enter a glucose value.');
      return;
    }
    const value = Number(glucose);
    if (!Number.isInteger(value) || value < 40 || value > 600) {
      setError('Value must be between 40 and 600 mg/dl.');
      return;
    }
    if (!date) {
      setError('Please pick a date.');
      return;
    }
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    if (date > todayStr) {
      setError('Date cannot be in the future.');
      return;
    }
    // One reading per slot per day, max 4 per day: check against the
    // readings already logged for this date (excluding the one being edited).
    setChecking(true);
    try {
      const day = await api.dailyReport(date);
      const others = day.readings.filter((r) => r.id !== initial?.id);
      if (others.length >= 4) {
        setError('You can add only 4 readings per day.');
        return;
      }
      if (others.some((r) => r.time_slot === timeSlot)) {
        setError(
          `You already have ${slotArticle(timeSlot)} ${SLOT_SHORT[timeSlot]} reading for this date.`,
        );
        return;
      }
    } catch (err) {
      // If the day's readings cannot be loaded, let the server decide.
    } finally {
      setChecking(false);
    }
    setError('');
    onSubmit({
      glucose_mg_dl: value,
      reading_date: date,
      time_slot: timeSlot,
      notes: notes.trim().slice(0, 200),
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error" style={{ marginBottom: 4 }}>{error}</div>}
      <div className="field">
        <label htmlFor="glucose">Blood glucose (mg/dL)</label>
        <input
          id="glucose"
          type="number"
          value={glucose}
          onChange={(e) => setGlucose(e.target.value)}
          placeholder="e.g. 112"
        />
      </div>
      <div className="field">
        <label htmlFor="rdate">Date</label>
        <input id="rdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label>Time slot</label>
        <div className="meal-pills">
          {TIME_SLOTS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`pill meal${timeSlot === opt ? ' active' : ''}`}
              data-meal={opt}
              onClick={() => setTimeSlot(opt)}
            >
              {SLOT_LABELS[opt]}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="notes">Notes (optional)</label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 200))}
          placeholder="What did you eat? How are you feeling?"
          maxLength={200}
        />
        <div className="char-count">{notes.length}/200</div>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn" type="submit" disabled={busy || checking}>
          {checking ? 'Checking…' : initial ? 'Save changes' : 'Save reading'}
        </button>
      </div>
    </form>
  );
}
