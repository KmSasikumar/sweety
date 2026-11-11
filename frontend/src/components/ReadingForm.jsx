import { useState } from 'react';
import { MEAL_LABELS } from '../api';

const MEAL_OPTIONS = ['fasting', 'before_meal', 'after_meal', 'bedtime', 'other'];

function splitLocal(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export default function ReadingForm({ initial, onSubmit, onCancel, busy }) {
  const start = initial ? splitLocal(initial.measured_at) : splitLocal(new Date().toISOString());
  const [glucose, setGlucose] = useState(initial ? String(initial.glucose_mg_dl) : '');
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [mealContext, setMealContext] = useState(initial ? initial.meal_context : 'fasting');
  const [notes, setNotes] = useState(initial ? initial.notes || '' : '');
  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const value = Number(glucose);
    if (!Number.isInteger(value) || value <= 0 || value >= 1000) {
      setError('Enter a glucose value between 1 and 999 mg/dL.');
      return;
    }
    if (!date || !time) {
      setError('Pick a date and a time.');
      return;
    }
    setError('');
    onSubmit({
      glucose_mg_dl: value,
      measured_at: new Date(`${date}T${time}:00`).toISOString(),
      meal_context: mealContext,
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
          min="1"
          max="999"
          value={glucose}
          onChange={(e) => setGlucose(e.target.value)}
          placeholder="e.g. 112"
          required
        />
      </div>
      <div className="form-row-2">
        <div className="field">
          <label htmlFor="rdate">Date</label>
          <input id="rdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="rtime">Time</label>
          <input id="rtime" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </div>
      </div>
      <div className="field">
        <label>Meal context</label>
        <div className="meal-pills">
          {MEAL_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`pill meal${mealContext === opt ? ' active' : ''}`}
              data-meal={opt}
              onClick={() => setMealContext(opt)}
            >
              {MEAL_LABELS[opt]}
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
