// App logo = the ICFAI Founders Network logo (src/assets/ifn-logo.png). Raster image
// (from the supplied JPG) rendered via <img>; size it with className (set a height,
// width follows the aspect ratio). Used in ~9 spots — login, onboarding, headers, spinners.
import logoUrl from '../assets/ifn-logo.png'

export default function Logo({ className = '' }) {
  return (
    <img
      src={logoUrl}
      className={className}
      alt="ICFAI Founders Network"
    />
  )
}
