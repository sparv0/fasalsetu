export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-1/3 bg-stone-200 rounded" />
      <div className="h-4 w-1/2 bg-stone-200 rounded" />
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="h-20 bg-stone-200 rounded-xl" />
        <div className="h-20 bg-stone-200 rounded-xl" />
        <div className="h-20 bg-stone-200 rounded-xl" />
      </div>
      <div className="h-40 bg-stone-200 rounded-xl" />
    </div>
  );
}
