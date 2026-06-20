// Pulsing placeholders for the pipeline surfaces, shaped like their loaded content.

// Row list (Pipeline home, Mentor Review tabs, admin board).
export function PipelineListSkeleton({ rows = 3 }) {
  return (
    <div className="card mt-4 animate-pulse divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-4">
          <div className="flex items-center gap-2">
            <div className="h-5 w-14 rounded-full bg-line" />
            <div className="h-4 w-1/2 rounded bg-line" />
            <div className="ml-auto h-5 w-20 rounded-full bg-line" />
          </div>
          <div className="mt-2.5 h-3 w-2/3 rounded bg-line" />
        </div>
      ))}
    </div>
  )
}

// Dossier page: header + gate circles + content blocks.
export function DossierSkeleton() {
  return (
    <div className="max-w-2xl animate-pulse">
      <div className="h-4 w-16 rounded bg-line" />
      <div className="mt-4 flex items-center gap-2">
        <div className="h-5 w-16 rounded-full bg-line" />
        <div className="h-5 w-20 rounded-full bg-line" />
      </div>
      <div className="mt-3 h-7 w-3/4 rounded bg-line" />
      <div className="mt-2 h-3.5 w-1/2 rounded bg-line" />

      {/* gate bar */}
      <div className="card mt-4 p-4">
        <div className="flex items-center">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`flex items-center ${i > 0 ? 'flex-1' : ''}`}>
              {i > 0 && <div className="h-0.5 flex-1 bg-line" />}
              <div className="h-8 w-8 shrink-0 rounded-full bg-line" />
            </div>
          ))}
        </div>
        <div className="mt-3 h-3.5 w-2/3 rounded bg-line" />
      </div>

      <div className="card mt-4 space-y-3 p-4">
        <div className="h-4 w-1/3 rounded bg-line" />
        <div className="h-3 w-full rounded bg-line" />
        <div className="h-3 w-5/6 rounded bg-line" />
        <div className="h-9 w-full rounded-lg bg-line" />
      </div>
      <div className="card mt-6 space-y-3 p-4">
        <div className="h-4 w-1/4 rounded bg-line" />
        <div className="h-3 w-full rounded bg-line" />
        <div className="h-3 w-3/4 rounded bg-line" />
      </div>
    </div>
  )
}
