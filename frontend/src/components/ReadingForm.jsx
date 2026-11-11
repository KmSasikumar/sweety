import { useState } from 'react';
import { TIME_SLOTS, SLOT_LABELS } from '../api';

export default function ReadingForm({ initial, onSubmit, onCancel, busy }) {
  const [glucose, setGlucose] = useState(initial ? String(initial.glucose_mg_dl) : '');
  const [date, setDate] = useState(
    initial ? String(initial.reading_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [timeSlot, setTimeSlot] = useState(initial ? initial.time_slot : 'morning');
  const [notes, setNotes] = useState(initial ? initial.notes || '' : '');
  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const value = Number(glucose);
    if (!Number.isInteger(value)) {
      setError('Enter a whole number for glucose.');
      return;
    }
    if (!date) {
      setError('Pick a date.');
      return;
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
          required
        />
      </div>
      <div className="field">
        <label htmlFor="rdate">Date</label>
        <input id="rdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
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
        <button className="btn" type="submit" disabled={busy}>
          {initial ? 'Save changes' : 'Save reading'}
        </button>
      </div>
    </form>
  );
}
