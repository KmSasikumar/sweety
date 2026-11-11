// Blood-drop logo mark for Sweety.
export default function BloodDrop({ size = 20, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Sweety logo">
      <path
        d="M12 2.5C12 2.5 5.5 10.2 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.2 12 2.5 12 2.5Z"
        fill={color}
      />
      <circle cx="9.4" cy="14.8" r="1.6" fill="rgba(255,255,255,0.55)" />
    </svg>
  );
}
