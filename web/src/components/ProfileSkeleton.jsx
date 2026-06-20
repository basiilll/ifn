// Pulsing placeholder shaped like the profile page (identity card + details card).
export default function ProfileSkeleton() {
  return (
    <div className="grid animate-pulse grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* identity */}
      <div className="card flex flex-col items-center p-5">
        <div className="h-20 w-20 rounded-full bg-line" />
        <div className="mt-4 h-4 w-32 rounded bg-line" />
        <div className="mt-2 h-5 w-16 rounded-full bg-line" />
        <div className="mt-2 h-3 w-24 rounded bg-line" />
        <div className="mt-5 h-9 w-full rounded-full bg-line" />
      </div>

      {/* details */}
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between border-b border-line pb-2">
          <div className="h-3 w-24 rounded bg-line" />
          <div className="h-7 w-24 rounded-full bg-line" />
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <div className="h-2.5 w-20 rounded bg-line" />
              <div className="mt-2 h-3.5 w-32 rounded bg-line" />
            </div>
          ))}
          <div className="sm:col-span-2">
            <div className="h-2.5 w-20 rounded bg-line" />
            <div className="mt-2 h-3.5 w-3/4 rounded bg-line" />
          </div>
        </div>
      </div>
    </div>
  )
}
