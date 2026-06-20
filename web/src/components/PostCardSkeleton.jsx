// Pulsing placeholder shaped like a PostCard, shown while the feed loads.
export default function PostCardSkeleton() {
  return (
    <div className="card animate-pulse p-5">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-full bg-line" />
        <div className="space-y-1.5">
          <div className="h-3 w-28 rounded bg-line" />
          <div className="h-2.5 w-16 rounded bg-line" />
        </div>
        <div className="ml-auto h-5 w-12 rounded-full bg-line" />
      </div>
      <div className="mt-4 h-4 w-3/4 rounded bg-line" />
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full rounded bg-line" />
        <div className="h-3 w-5/6 rounded bg-line" />
      </div>
    </div>
  )
}
