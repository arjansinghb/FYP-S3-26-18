// Shared boolean-setting row (label + switch) — used by PA21 (safety
// settings), PA22 (notification preferences), PA29 (privacy settings).
interface Props {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export default function Toggle({ label, hint, checked, onChange, disabled }: Props) {
  return (
    <div className="toggle-row">
      <div>
        <div className="toggle-row-label">{label}</div>
        {hint && <div className="toggle-row-hint">{hint}</div>}
      </div>
      <label className="toggle-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="toggle-switch-track" />
      </label>
    </div>
  )
}
