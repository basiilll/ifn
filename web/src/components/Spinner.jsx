export default function Spinner({ size = 20, className = '' }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-line border-t-accent ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
