import React, { useState, useRef, useCallback } from "react";

interface TooltipData {
  date: string;
  intensity: number;
  completedCount: number;
  totalMandatory: number;
  hasBonus: boolean;
  taskBreakdown: { title: string; value: number; target: number }[];
}

interface HeatmapTooltipProps {
  children: (
    showTooltip: (e: React.MouseEvent, data: TooltipData) => void,
    hideTooltip: () => void
  ) => React.ReactNode;
}

export function HeatmapTooltip({ children }: HeatmapTooltipProps) {
  const [tooltip, setTooltip] = useState<{
    data: TooltipData;
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const showTooltip = useCallback((e: React.MouseEvent, data: TooltipData) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTooltip({ data, x, y });
  }, []);

  const hideTooltip = useCallback(() => setTooltip(null), []);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  };

  const intensityLabel = (i: number, hasBonus: boolean) => {
    if (hasBonus) return "🌟 Ultra Bonus Day!";
    if (i === 0) return "No activity";
    if (i === 1) return "Started";
    if (i === 2) return "Partial progress";
    if (i === 3) return "Good progress";
    return "All tasks complete!";
  };

  return (
    <div ref={containerRef} className="relative">
      {children(showTooltip, hideTooltip)}

      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: Math.min(tooltip.x + 12, (containerRef.current?.offsetWidth || 400) - 200),
            top: tooltip.y - 10,
            transform: "translateY(-100%)",
          }}
        >
          <div className="bg-[#0A0A0A] border border-white/20 rounded-xl p-3 shadow-2xl min-w-[180px] max-w-[220px]">
            <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">
              {formatDate(tooltip.data.date)}
            </div>
            <div className={`text-xs font-bold mb-2 ${tooltip.data.hasBonus ? "text-yellow-400" : "text-white"}`}>
              {intensityLabel(tooltip.data.intensity, tooltip.data.hasBonus)}
            </div>

            {tooltip.data.taskBreakdown.length > 0 && (
              <div className="space-y-1.5 border-t border-white/10 pt-2">
                {tooltip.data.taskBreakdown.map((task, i) => {
                  const done = task.value >= task.target;
                  const pct = Math.min(100, Math.round((task.value / task.target) * 100));
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] text-white/60 truncate max-w-[120px]">{task.title}</span>
                        <span className={`text-[10px] font-bold ${done ? "text-emerald-400" : "text-white/40"}`}>
                          {task.value}/{task.target}
                        </span>
                      </div>
                      <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${done ? "bg-emerald-400" : "bg-white/30"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {tooltip.data.taskBreakdown.length === 0 && tooltip.data.intensity === 0 && (
              <div className="text-[10px] text-white/30 italic">No logs recorded</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}