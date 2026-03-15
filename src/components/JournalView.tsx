import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, Calendar, ChevronDown, ChevronUp, Search, Tag, X } from "lucide-react";
import { Log, Task } from "../types";

interface JournalViewProps {
  logs: Log[];
  tasks: Task[];
  userId: string;
}

function parseDetails(details?: string | null) {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details);
    if (parsed.concept && parsed.summary) return parsed;
    return { concept: "Note", summary: details };
  } catch {
    return { concept: "Note", summary: details };
  }
}

const TYPE_COLORS: Record<string, string> = {
  sql: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  pyspark: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  project: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  custom: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

export function JournalView({ logs, tasks, userId }: JournalViewProps) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "task">("date");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const userLogs = useMemo(
    () =>
      logs
        .filter((l) => l.user_id === userId && l.details)
        .filter((l) => {
          const parsed = parseDetails(l.details);
          if (!parsed) return false;
          const task = tasks.find((t) => t.id === l.task_id);
          const matchesSearch =
            !search ||
            parsed.concept.toLowerCase().includes(search.toLowerCase()) ||
            parsed.summary.toLowerCase().includes(search.toLowerCase()) ||
            task?.title.toLowerCase().includes(search.toLowerCase());
          const matchesType = filterType === "all" || task?.type === filterType;
          return matchesSearch && matchesType;
        })
        .sort((a, b) => {
          if (sortBy === "date") return b.date.localeCompare(a.date);
          const taskA = tasks.find((t) => t.id === a.task_id)?.title || "";
          const taskB = tasks.find((t) => t.id === b.task_id)?.title || "";
          return taskA.localeCompare(taskB);
        }),
    [logs, tasks, userId, search, filterType, sortBy]
  );

  // Group by date for date sort
  const grouped = useMemo(() => {
    if (sortBy !== "date") return null;
    const groups = new Map<string, typeof userLogs>();
    for (const log of userLogs) {
      const arr = groups.get(log.date) || [];
      arr.push(log);
      groups.set(log.date, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [userLogs, sortBy]);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00");
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    if (dateStr === today) return "Today";
    if (dateStr === yesterday) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  const LogCard = ({ log }: { log: Log }) => {
    const task = tasks.find((t) => t.id === log.task_id);
    const parsed = parseDetails(log.details);
    if (!parsed) return null;
    const isExpanded = expandedIds.has(log.id);

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[#1A1A1A] border border-white/5 rounded-xl overflow-hidden hover:border-white/15 transition-all"
      >
        <button
          onClick={() => toggleExpand(log.id)}
          className="w-full text-left p-4 flex items-start gap-3"
        >
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {task && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md border uppercase tracking-wider ${
                    TYPE_COLORS[task.type] || TYPE_COLORS.custom
                  }`}
                >
                  {task.type}
                </span>
              )}
              <span className="text-[11px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-md">
                {parsed.concept}
              </span>
              <span className="text-[10px] text-white/30 ml-auto">{sortBy === "task" ? formatDate(log.date) : ""}</span>
            </div>
            <p className="text-xs text-white/60 leading-relaxed line-clamp-2">{parsed.summary}</p>
            {task && (
              <p className="text-[10px] text-white/30 mt-1.5 truncate">{task.title}</p>
            )}
          </div>
          <div className="text-white/30 mt-0.5 flex-shrink-0">
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 border-t border-white/5 pt-3">
                <p className="text-sm text-white/80 leading-relaxed">{parsed.summary}</p>
                <div className="flex items-center gap-3 mt-3 text-[10px] text-white/30 font-medium">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {log.date}
                  </span>
                  <span>Progress logged: {log.value}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search concepts, summaries..."
            className="w-full pl-9 pr-4 py-2.5 bg-[#1A1A1A] border border-white/10 rounded-xl text-sm outline-none focus:border-white/30 transition-colors text-white placeholder-white/30"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2.5 bg-[#1A1A1A] border border-white/10 rounded-xl text-sm outline-none focus:border-white/30 transition-colors text-white"
          >
            <option value="all">All types</option>
            <option value="sql">SQL</option>
            <option value="pyspark">PySpark</option>
            <option value="project">Project</option>
            <option value="custom">Custom</option>
          </select>

          <div className="flex bg-[#1A1A1A] border border-white/10 rounded-xl overflow-hidden">
            <button
              onClick={() => setSortBy("date")}
              className={`px-3 py-2 text-xs font-bold transition-colors ${
                sortBy === "date" ? "bg-white text-black" : "text-white/40 hover:text-white"
              }`}
            >
              By Date
            </button>
            <button
              onClick={() => setSortBy("task")}
              className={`px-3 py-2 text-xs font-bold transition-colors ${
                sortBy === "task" ? "bg-white text-black" : "text-white/40 hover:text-white"
              }`}
            >
              By Task
            </button>
          </div>
        </div>
      </div>

      {/* Count */}
      <div className="text-xs text-white/30 font-medium">
        {userLogs.length} {userLogs.length === 1 ? "entry" : "entries"} found
      </div>

      {/* Log List */}
      {userLogs.length === 0 ? (
        <div className="text-center py-16 text-white/20">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-bold uppercase tracking-widest">No journal entries yet</p>
          <p className="text-xs mt-1 text-white/20">
            {search || filterType !== "all" ? "Try adjusting your filters" : "Log some progress to start your learning journal"}
          </p>
        </div>
      ) : sortBy === "date" && grouped ? (
        <div className="space-y-6">
          {grouped.map(([date, dateLogs]) => (
            <div key={date}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-bold text-white/80">{formatDate(date)}</span>
                <div className="flex-1 h-px bg-white/5" />
                <span className="text-[10px] text-white/30">{date}</span>
              </div>
              <div className="space-y-2">
                {dateLogs.map((log) => (
                  <LogCard key={log.id} log={log} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {userLogs.map((log) => (
            <LogCard key={log.id} log={log} />
          ))}
        </div>
      )}
    </div>
  );
}