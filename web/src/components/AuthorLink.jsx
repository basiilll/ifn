import { Link } from 'react-router-dom'

// Turns a name/avatar into a link to the member's public profile (/u/:id). No id (anonymous
// post, or masked) renders plain text. stopPropagation so it works inside a clickable card.
export default function AuthorLink({ id, className = '', children }) {
  if (!id) return <span className={className}>{children}</span>
  return (
    <Link to={`/u/${id}`} className={`${className} hover:underline`} onClick={(e) => e.stopPropagation()}>
      {children}
    </Link>
  )
}
