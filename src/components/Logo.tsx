export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-9 w-9 place-items-center rounded-full bg-white text-[#0096d6] shadow-sm ring-1 ring-slate-200">
        <svg viewBox="0 0 64 64" aria-label="HP" className="h-6 w-6" role="img">
          <text
            x="31.5"
            y="42"
            fill="currentColor"
            fontFamily="Arial, Helvetica, sans-serif"
            fontSize="31"
            fontStyle="italic"
            fontWeight="700"
            letterSpacing="-4"
            textAnchor="middle"
          >
            hp
          </text>
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">Sistema de ticket</div>
      </div>
    </div>
  );
}
