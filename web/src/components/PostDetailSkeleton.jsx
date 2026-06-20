// Pulsing placeholder shaped like the post detail page, shown while it loads.
export default function PostDetailSkeleton() {
  return (
    <div className="max-w-2xl animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-full bg-line" />
        <div className="space-y-1.5">
          <div className="h-3 w-32 rounded bg-line" />
          <div className="h-2.5 w-16 rounded bg-line" />
        </div>
        <div className="ml-auto h-5 w-12 rounded-full bg-line" />
      </div>
      <div className="mt-4 h-6 w-4/5 rounded bg-line" />
      <div className="mt-4 space-y-2.5">
        <div className="h-3 w-full rounded bg-line" />
        <div className="h-3 w-full rounded bg-line" />
        <div className="h-3 w-2/3 rounded bg-line" />
      </div>
      <div className="mt-5 flex gap-2">
        <div className="h-9 w-28 rounded-full bg-line" />
        <div className="h-9 w-16 rounded-full bg-line" />
      </div>
    </div>
  )
}
