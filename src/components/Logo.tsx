export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-sky-500 to-emerald-500" />
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">Service Desk</div>
        <div className="text-xs text-zinc-400">ITSM · ITIL</div>
      </div>
    </div>
  );
}

