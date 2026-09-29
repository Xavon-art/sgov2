export function LoadingState() {
  return (
    <div className="flex min-h-[45vh] items-center justify-center gap-3 text-sm text-ink-muted">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-brass"
      />
      Loading demo data…
    </div>
  );
}