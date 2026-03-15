import React, { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, Zap, BookOpen } from "lucide-react";
import { Log, Task } from "../types";

interface WeeklySummaryProps {
  logs: Log[];
  tasks: Task[];
  userId: string;
}

function getWeekRange(weeksAgo: number = 0) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) - weeksAgo * 7);
  monday.setHours(0, 0, 0, 0);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

export function WeeklySummary({ logs, tasks, userId }: WeeklySummaryProps) {
  const userLogs = useMemo(() => logs.filter((l) => l.user_id === userId), [logs, userId]);
  const userTasks = useMemo(() => tasks.filter((t) => t.user_id === userId), [tasks, userId]);

  const thisWeek = useMemo(() => getWeekRange(0), []);
  const lastWeek = useMemo(() => getWeekRange(1), []);

  const computeWeekStats = (dates: string[]) => {
    const weekLogs = userLogs.filter((l) => dates.includes(l.date));
    const totalVolume = weekLogs.reduce((sum, l) => sum + (l.value || 0), 0);

    const today = new Date().toISOString().split("T")[0];
    const activeDays = dates.filter((date) =>
      date <= today &&
      userTasks.some((t) => {
        const log = weekLogs.find((l) => l.task_id === t.id && l.date === date);
        return log && log.value >= t.target_daily;
      })
    );

    const missedDays = dates
      .filter((d) => d < today) // strictly past days only — today doesn't count as missed yet
      .filter((d) => !activeDays.includes(d));

    const byType: Record<string, number> = {};
    for (const log of weekLogs) {
      const task = userTasks.find((t) => t.id === log.task_id);
      if (task) {
        byType[task.type] = (byType[task.type] || 0) + log.value;
      }
    }

    const concepts: string[] = [];
    for (const log of weekLogs) {
      if (log.details) {
        try {
          const parsed = JSON.parse(log.details);
          if (parsed.concept && !concepts.includes(parsed.concept)) {
            concepts.push(parsed.concept);
          }
        } catch {}
      }
    }

    return { totalVolume, activeDays: activeDays.length, missedDays: missedDays.length, byType, concepts };
  };

  const thisStats = useMemo(() => computeWeekStats(thisWeek), [thisWeek, userLogs, userTasks]);
  const lastStats = useMemo(() => computeWeekStats(lastWeek), [lastWeek, userLogs, userTasks]);

  const volumeTrend =
    lastStats.totalVolume === 0
      ? null
      : Math.round(((thisStats.totalVolume - lastStats.totalVolume) / lastStats.totalVolume) * 100);

  const typeLabels: Record<string, string> = {
    sql: "SQL",
    pyspark: "PySpark",
    project: "Projects",
    custom: "Custom",
  };

  const typeColors: Record<string, string> = {
    sql: "text-blue-400 bg-blue-400/10",
    pyspark: "text-yellow-400 bg-yellow-400/10",
    project: "text-purple-400 bg-purple-400/10",
    custom: "text-emerald-400 bg-emerald-400/10",
  };

  const topType = Object.entries(thisStats.byType).sort(([, a], [, b]) => b - a)[0];

  const generateNarrative = () => {
    const lines: string[] = [];

    if (thisStats.totalVolume === 0) {
      return "No activity logged this week yet. Start logging to see your weekly digest!";
    }

    if (thisStats.activeDays >= 5) {
      lines.push(`Strong week — you logged on ${thisStats.activeDays} out of 7 days.`);
    } else if (thisStats.activeDays >= 3) {
      lines.push(`Decent week — you stayed active on ${thisStats.activeDays} days.`);
    } else {
      lines.push(`Tough week — only ${thisStats.activeDays} active ${thisStats.activeDays === 1 ? "day" : "days"}.`);
    }

    if (topType) {
      lines.push(`Your main focus was ${typeLabels[topType[0]] || topType[0]} with ${topType[1]} units logged.`);
    }

    if (thisStats.missedDays > 0) {
      lines.push(`You missed ${thisStats.missedDays} ${thisStats.missedDays === 1 ? "day" : "days"} — consider using a streak freeze next time.`);
    }

    if (thisStats.concepts.length > 0) {
      lines.push(
        `Key concepts learned: ${thisStats.concepts.slice(0, 3).join(", ")}${thisStats.concepts.length > 3 ? ` and ${thisStats.concepts.length - 3} more` : ""}.`
      );
    }

    return lines.join(" ");
  };

  const weekLabel = (dates: string[]) => {
    const start = new Date(dates[0] + "T12:00:00");
    const end = new Date(dates[6] + "T12:00:00");
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(start)} – ${fmt(end)}`;
  };

  return (
    <div className="space-y-6">
      {/* Narrative */}
      <div className="bg-gradient-to-br from-emerald-500/10 to-blue-500/10 border border-emerald-500/20 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-emerald-400/60 uppercase tracking-widest font-bold">{weekLabel(thisWeek)}</span>
        </div>
        <p className="text-sm text-white/80 leading-relaxed">{generateNarrative()}</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Active Days */}
        <div className="bg-[#1A1A1A] border border-white/5 rounded-xl p-4">
          <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Active Days</div>
          <div className="text-2xl font-bold font-mono">{thisStats.activeDays}<span className="text-base text-white/30">/7</span></div>
          <div className="flex items-center gap-1 mt-1 text-[10px] text-white/30">
            vs {lastStats.activeDays} last week
          </div>
        </div>

        {/* Volume */}
        <div className="bg-[#1A1A1A] border border-white/5 rounded-xl p-4">
          <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Total Volume</div>
          <div className="text-2xl font-bold font-mono">{thisStats.totalVolume}</div>
          <div className="flex items-center gap-1 mt-1 text-[10px]">
            {volumeTrend === null ? (
              <span className="text-white/30">No prior data</span>
            ) : volumeTrend > 0 ? (
              <>
                <TrendingUp className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">+{volumeTrend}%</span>
              </>
            ) : volumeTrend < 0 ? (
              <>
                <TrendingDown className="w-3 h-3 text-red-400" />
                <span className="text-red-400">{volumeTrend}%</span>
              </>
            ) : (
              <>
                <Minus className="w-3 h-3 text-white/30" />
                <span className="text-white/30">Same as last week</span>
              </>
            )}
          </div>
        </div>

        {/* Missed days */}
        <div className="bg-[#1A1A1A] border border-white/5 rounded-xl p-4">
          <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Missed Days</div>
          <div className={`text-2xl font-bold font-mono ${thisStats.missedDays > 2 ? "text-red-400" : thisStats.missedDays > 0 ? "text-yellow-400" : "text-emerald-400"}`}>
            {thisStats.missedDays}
          </div>
          <div className="text-[10px] text-white/30 mt-1">
            {thisStats.missedDays === 0 ? "Perfect so far! 🎉" : `${thisStats.missedDays} past ${thisStats.missedDays === 1 ? "day" : "days"} missed`}
          </div>
        </div>

        {/* Concepts */}
        <div className="bg-[#1A1A1A] border border-white/5 rounded-xl p-4">
          <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Concepts</div>
          <div className="text-2xl font-bold font-mono">{thisStats.concepts.length}</div>
          <div className="text-[10px] text-white/30 mt-1 flex items-center gap-1">
            <BookOpen className="w-3 h-3" /> Feynman logs
          </div>
        </div>
      </div>

      {/* Type breakdown */}
      {Object.keys(thisStats.byType).length > 0 && (
        <div className="bg-[#1A1A1A] border border-white/5 rounded-xl p-4">
          <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4">Focus Breakdown</div>
          <div className="space-y-3">
            {Object.entries(thisStats.byType)
              .sort(([, a], [, b]) => b - a)
              .map(([type, volume]) => {
                const maxVol = Math.max(...Object.values(thisStats.byType));
                const pct = Math.round((volume / maxVol) * 100);
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${typeColors[type] || typeColors.custom}`}>
                        {typeLabels[type] || type}
                      </span>
                      <span className="text-xs font-bold text-white/60">{volume} units</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Concepts list */}
      {thisStats.concepts.length > 0 && (
        <div className="bg-[#1A1A1A] border border-white/5 rounded-xl p-4">
          <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-3">Concepts Learned This Week</div>
          <div className="flex flex-wrap gap-2">
            {thisStats.concepts.map((concept, i) => (
              <span key={i} className="text-[11px] font-bold px-2.5 py-1 bg-white/5 rounded-lg text-white/70 border border-white/10">
                {concept}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}