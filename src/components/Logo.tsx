export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[hsl(var(--brand-cyan))] via-[hsl(var(--brand-blue))] to-[hsl(var(--brand-violet))] shadow-sm">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-white">
          <path
            d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8L12 3.5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M8.2 9.2 12 11.5l3.8-2.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M12 11.5V17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">Service Desk</div>
        <div className="text-xs text-muted-foreground">ITSM · ITIL</div>
      </div>
    </div>
  );
}
