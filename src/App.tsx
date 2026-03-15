import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Brain, Database, Terminal, Briefcase, Plus, Users, Flame, LogOut, Share2,
  X, Info, Trash2, Edit2, Settings2, Trophy, Medal, Zap, ChevronRight,
  Loader2, WifiOff, User, BookOpen, LayoutDashboard, Snowflake, Layers,
} from "lucide-react";
import { cn, User as UserType, Task, Log, AppState, StreakFreeze } from "./types";
import confetti from "canvas-confetti";
import { motion, AnimatePresence } from "framer-motion";
import { calculateXP, calculateLevel, calculateBadges, getLeagueInfo, getStreak, canUseStreakFreeze } from "./utils/gamification";
import { useWebSocket } from "./hooks/useWebSocket";
import { useOfflineQueue } from "./hooks/useOfflineQueue";
import { ConfirmModal } from "./components/ConfirmModal";
import { HeatmapTooltip } from "./components/HeatmapTooltip";
import { JournalView } from "./components/JournalView";
import { WeeklySummary } from "./components/WeeklySummary";
import { ProfileSettings } from "./components/ProfileSettings";
import { TaskTemplates } from "./components/TaskTemplates";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseLogDetails = (detailsString?: string) => {
  if (!detailsString) return null;
  try {
    const parsed = JSON.parse(detailsString);
    if (parsed.concept && parsed.summary) return parsed;
    return { concept: "General", summary: detailsString };
  } catch {
    return { concept: "Note", summary: detailsString };
  }
};

const AppLogo = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
  const sizes = { sm: "w-4 h-4", md: "w-5 h-5", lg: "w-6 h-6" };
  const pads = { sm: "p-1.5", md: "p-2", lg: "p-3" };
  return (
    <div className={`bg-white rounded-xl shadow-sm flex items-center justify-center ${pads[size]}`}>
      <Brain className={`text-black ${sizes[size]}`} />
    </div>
  );
};

// ─── Auth Storage ─────────────────────────────────────────────────────────────
const SESSION_KEY = "lt_session";

function saveSession(userId: string, token: string, user: UserType, roomId: string) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, token, user, roomId }));
  } catch {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s?.userId && s?.token && s?.user) return s;
  } catch {}
  return null;
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="p-8 text-center text-white/40">
            <p className="text-sm font-bold mb-2">Something went wrong</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="text-xs underline hover:text-white"
            >
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "journal" | "weekly">("dashboard");
  const [user, setUser] = useState<UserType | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string>("default");
  const [state, setState] = useState<AppState>({ users: [], tasks: [], logs: [], streakFreezes: [] });
  const [isJoining, setIsJoining] = useState(true);
  const [userName, setUserName] = useState("");
  const [handle, setHandle] = useState("");
  const [inputRoomId, setInputRoomId] = useState("default");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const heatmapScrollRef = useRef<HTMLDivElement>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);

  // Modals
  const [activeLogTask, setActiveLogTask] = useState<{ task: Task; date: string } | null>(null);
  const [logConcept, setLogConcept] = useState("");
  const [logSummary, setLogSummary] = useState("");
  const [logValue, setLogValue] = useState<number>(1);
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskTarget, setNewTaskTarget] = useState("1");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: "", message: "", onConfirm: () => {} });

  // Admin
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);
  const [adminData, setAdminData] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [adminConfirmModal, setAdminConfirmModal] = useState<{
    isOpen: boolean;
    userId: string;
    userName: string;
  }>({ isOpen: false, userId: "", userName: "" });
  const [roomIdCopied, setRoomIdCopied] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const cleanedHandle = handle.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "");

  // ── WebSocket message handler ────────────────────────────────────────────────
  const handleWsMessage = useCallback((message: any) => {
    if (message.type === "log_updated") {
      setState((prev) => {
        const newLogs = [...prev.logs];
        const idx = newLogs.findIndex(
          (l) => l.user_id === message.payload.userId && l.task_id === message.payload.taskId && l.date === message.payload.date
        );
        if (idx > -1) {
          newLogs[idx] = { ...newLogs[idx], value: message.payload.value, details: message.payload.details };
        } else {
          newLogs.push({ id: Date.now(), ...message.payload });
        }
        return { ...prev, logs: newLogs };
      });
    }
    if (message.type === "task_added") {
      setState((prev) => {
        if (prev.tasks.some((t) => t.id === message.payload.id)) return prev;
        return {
          ...prev,
          tasks: [...prev.tasks, {
            id: message.payload.id,
            user_id: message.payload.userId,
            title: message.payload.title,
            type: message.payload.type,
            target_daily: message.payload.targetDaily,
            sort_order: message.payload.sort_order ?? prev.tasks.length,
          }],
        };
      });
    }
    if (message.type === "task_deleted") {
      setState((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== message.payload.taskId),
        logs: prev.logs.filter((l) => l.task_id !== message.payload.taskId),
      }));
    }
    if (message.type === "tasks_reordered") {
      setState((prev) => {
        const { taskIds, userId } = message.payload;
        const updated = prev.tasks.map((t) => {
          if (t.user_id !== userId) return t;
          const idx = taskIds.indexOf(t.id);
          return idx === -1 ? t : { ...t, sort_order: idx };
        });
        return { ...prev, tasks: updated.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) };
      });
    }
  }, []);

  // ── WebSocket setup ──────────────────────────────────────────────────────────
  const { send, isConnected } = useWebSocket(
    token,
    roomId,
    user?.id ?? null,
    handleWsMessage,
    !isJoining
  );

  // ── Offline queue ────────────────────────────────────────────────────────────
  const { enqueue, isOnline, pendingCount } = useOfflineQueue(send, isConnected);

  // ── Session restore ──────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.add("dark");
    const session = loadSession();
    if (session) {
      setUser(session.user);
      setToken(session.token);
      setRoomId(session.roomId);
      setIsJoining(false);
      fetchState(session.roomId);
    }
  }, []);

  // ── Leaderboard ──────────────────────────────────────────────────────────────
  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const data = await res.json();
      setLeaderboard(data.leaderboard || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchLeaderboard();
      }
    }, 30000);
    // Also refetch when tab becomes visible again after being hidden
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchLeaderboard();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchLeaderboard]);

  // ── Heatmap auto-scroll ──────────────────────────────────────────────────────
  useEffect(() => {
    const scroll = () => {
      if (heatmapScrollRef.current) {
        heatmapScrollRef.current.scrollLeft = heatmapScrollRef.current.scrollWidth;
      }
    };
    requestAnimationFrame(() => {
      scroll();
      setTimeout(scroll, 50);
      setTimeout(scroll, 200);
    });
  }, [activeTab]);

  // ── Fetch state ──────────────────────────────────────────────────────────────
  const fetchState = async (rId: string) => {
    try {
      const res = await fetch(`/api/state/${rId}`);
      const data = await res.json();
      if (data._offline) return; // stale cache during offline
      setState({
        users: data.users || [],
        tasks: data.tasks || [],
        logs: data.logs || [],
        streakFreezes: data.streakFreezes || [],
      });
    } catch {}
  };

  // ── Join / Auth ──────────────────────────────────────────────────────────────
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;
    if (!cleanedHandle) {
      setJoinError("Username must contain at least one letter, number, or underscore.");
      setIsLoggingIn(false);
      return;
    }
    setJoinError(null);
    setIsLoggingIn(true);
    try {
      const res = await fetch("/api/init-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: userName, roomId: inputRoomId, username: handle }),
      });
      const data = await res.json();
      if (!res.ok) {
        setJoinError(data.error || "Failed to join");
        return;
      }
      if (data.success) {
        const newUser: UserType = { id: data.userId, name: userName, room_id: inputRoomId, username: handle };
        setUser(newUser);
        setToken(data.token);
        setRoomId(inputRoomId);
        setIsJoining(false);
        saveSession(data.userId, data.token, newUser, inputRoomId);
        fetchState(inputRoomId);
      }
    } catch {
      setJoinError("Connection error. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    clearSession();
    setUser(null);
    setToken(null);
    setRoomId("default");
    setUserName("");
    setIsJoining(true);
  };

  // ── Actions ──────────────────────────────────────────────────────────────────
  const updateLog = useCallback(
    (taskId: string, date: string, value: number, details?: string) => {
      if (!user) return;
      const payload = { userId: user.id, taskId, date, value, details };
      enqueue("update_log", payload);

      // Optimistic update
      setState((prev) => {
        const newLogs = [...prev.logs];
        const idx = newLogs.findIndex((l) => l.user_id === user.id && l.task_id === taskId && l.date === date);
        if (idx > -1) {
          newLogs[idx] = { ...newLogs[idx], value, details };
        } else {
          newLogs.push({ id: Date.now(), user_id: user.id, task_id: taskId, date, value, details });
        }
        return { ...prev, logs: newLogs };
      });

      const task = state.tasks.find((t) => t.id === taskId);
      if (value > 0) {
        const isMega = task && value >= task.target_daily * 5;
        confetti({
          particleCount: isMega ? 150 : 50,
          spread: isMega ? 100 : 60,
          origin: { y: 0.8 },
          colors: isMega ? ["#f59e0b", "#ef4444", "#8b5cf6", "#3b82f6"] : ["#10b981", "#3b82f6", "#f59e0b"],
          scalar: isMega ? 1.5 : 1,
        });
      }
    },
    [user, state.tasks, enqueue]
  );

  const addTask = useCallback(
    (title: string, type: Task["type"], targetDaily: number) => {
      if (!user) return;
      enqueue("add_task", { userId: user.id, title, type, targetDaily });
    },
    [user, enqueue]
  );

  const deleteTask = useCallback(
    (taskId: string) => {
      if (!user) return;
      setConfirmModal({
        isOpen: true,
        title: "Delete Task",
        message: "This will permanently delete the task and all its progress logs. Are you sure?",
        onConfirm: () => {
          enqueue("delete_task", { taskId });
          setConfirmModal((p) => ({ ...p, isOpen: false }));
        },
      });
    },
    [user, enqueue]
  );

  const useStreakFreeze = useCallback(
    async (date: string) => {
      if (!token) return;
      try {
        const res = await fetch("/api/streak-freeze", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ date }),
        });
        if (res.ok) {
          // Optimistic update
          setState((prev) => ({
            ...prev,
            streakFreezes: [...prev.streakFreezes, { id: Date.now(), user_id: user!.id, used_on: date }],
          }));
        } else {
          const data = await res.json();
          alert(data.error);
        }
      } catch {}
    },
    [token, user]
  );

  // ── Memoized streak ──────────────────────────────────────────────────────────
  const myStreak = useMemo(
    () => (user ? getStreak(user.id, state.tasks, state.logs, state.streakFreezes) : 0),
    [user, state.tasks, state.logs, state.streakFreezes]
  );

  const myXP = useMemo(() => (user ? calculateXP(state.logs, user.id) : 0), [user, state.logs]);
  const myLevel = useMemo(() => calculateLevel(myXP), [myXP]);
  const myBadges = useMemo(
    () => (user ? calculateBadges(state.logs, user.id, myStreak, state.tasks) : []),
    [user, state.logs, myStreak, state.tasks]
  );

  const canFreeze = useMemo(
    () => (user ? canUseStreakFreeze(user.id, state.streakFreezes) : false),
    [user, state.streakFreezes]
  );

  const xpProgress = useMemo(() => {
    const xpForCurrentLevel = (myLevel - 1) * 100;
    return ((myXP - xpForCurrentLevel) / 100) * 100;
  }, [myXP, myLevel]);

  const userTasks = useMemo(
    () =>
      state.tasks
        .filter((t) => t.user_id === user?.id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.tasks, user]
  );

  const journalEntryCount = useMemo(
    () => state.logs.filter((l) => l.user_id === user?.id && l.details).length,
    [state.logs, user]
  );

  // ── Dynamic page title ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      document.title = "Learning Tracker";
      return;
    }
    const tabLabels: Record<string, string> = {
      dashboard: "Dashboard",
      journal: "Journal",
      weekly: "Weekly",
    };
    const streakText = myStreak > 0 ? ` 🔥${myStreak}` : "";
    document.title = `${tabLabels[activeTab] || "Dashboard"}${streakText} — Learning Tracker`;
    return () => {
      document.title = "Learning Tracker";
    };
  }, [activeTab, myStreak, user]);

  // ── Heatmap data ─────────────────────────────────────────────────────────────
  const lastDays = useMemo(() => {
    const days: string[] = [];
    const numColumns = 53;
    const totalDays = numColumns * 7;
    const d = new Date();
    const dayOfWeek = d.getDay();
    for (let i = totalDays - (7 - (dayOfWeek + 1)); i >= 0; i--) {
      const day = new Date();
      day.setDate(day.getDate() - i);
      days.push(day.toISOString().split("T")[0]);
    }
    return days;
  }, []);

  const activityMap = useMemo(() => {
    const map: Record<string, { intensity: number; completedCount: number; totalMandatory: number; hasBonus: boolean; taskBreakdown: any[] }> = {};
    if (!user) return map;
    const userLogs = state.logs.filter((l) => l.user_id === user.id);

    lastDays.forEach((date) => {
      const dayLogs = userLogs.filter((l) => l.date === date);
      let intensity = 0;
      let completedCount = 0;
      let hasBonus = false;
      const taskBreakdown = userTasks.map((t) => {
        const log = dayLogs.find((l) => l.task_id === t.id);
        return { title: t.title, value: log?.value || 0, target: t.target_daily };
      });

      if (userTasks.length > 0) {
        completedCount = userTasks.filter((t) => {
          const log = dayLogs.find((l) => l.task_id === t.id);
          return (log?.value || 0) >= t.target_daily;
        }).length;
        const ratio = completedCount / userTasks.length;
        if (completedCount === 0 && dayLogs.some((l) => l.value > 0)) intensity = 1;
        else if (ratio > 0 && ratio < 0.5) intensity = 2;
        else if (ratio >= 0.5 && ratio < 1) intensity = 3;
        else if (ratio === 1) intensity = 4;
        hasBonus = userTasks.some((t) => {
          const log = dayLogs.find((l) => l.task_id === t.id);
          return log && log.value >= t.target_daily * 5;
        });
      }
      map[date] = { intensity, completedCount, totalMandatory: userTasks.length, hasBonus, taskBreakdown };
    });
    return map;
  }, [state.logs, user, userTasks, lastDays]);

  // ── Admin ────────────────────────────────────────────────────────────────────
  const fetchAdminData = async (t: string) => {
    try {
      const res = await fetch("/api/admin/data", { headers: { Authorization: t } });
      if (res.ok) setAdminData(await res.json());
      else setAdminToken(null);
    } catch { setAdminToken(null); }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdminLoggingIn(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: adminUsername, password: adminPassword }),
      });
      if (res.ok) {
        const data = await res.json();
        setAdminToken(data.token);
        await fetchAdminData(data.token);
      } else {
        alert("Invalid credentials");
      }
    } catch { alert("Connection error"); }
    finally { setIsAdminLoggingIn(false); }
  };

  const handleLogSubmit = () => {
    if (activeLogTask) {
      const details = JSON.stringify({ concept: logConcept.trim(), summary: logSummary.trim() });
      updateLog(activeLogTask.task.id, activeLogTask.date, logValue, details);
      setActiveLogTask(null);
      setLogConcept("");
      setLogSummary("");
      setLogValue(1);
    }
  };

  // ── Admin view ───────────────────────────────────────────────────────────────
  if (adminToken && adminData) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white p-8 font-sans">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <AppLogo size="lg" />
              <h1 className="text-2xl font-bold">Admin Dashboard</h1>
            </div>
            <button
              onClick={() => { setAdminToken(null); setIsAdminMode(false); setAdminData(null); }}
              className="px-4 py-2 bg-white/10 rounded-xl hover:bg-white/20 text-sm font-bold flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" /> Exit
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-[#1A1A1A] p-6 rounded-2xl border border-white/10">
              <h2 className="text-lg font-bold mb-4 text-emerald-400 flex items-center gap-2">
                <Users className="w-5 h-5" /> Users ({adminData.users.length})
              </h2>
              <div className="space-y-2">
                {adminData.users.map((u: UserType) => (
                  <div key={u.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
                    <div>
                      <div className="font-bold text-sm">{u.name} <span className="text-white/30">@{u.username}</span></div>
                      <div className="text-[10px] text-white/40 uppercase tracking-widest">Room: {u.room_id}</div>
                    </div>
                    <button
                      onClick={() => setAdminConfirmModal({ isOpen: true, userId: u.id, userName: u.name })}
                      className="p-2 text-white/20 hover:text-red-400 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="lg:col-span-2 bg-[#1A1A1A] p-6 rounded-2xl border border-white/10">
              <h2 className="text-lg font-bold mb-4 text-blue-400 flex items-center gap-2">
                <Briefcase className="w-5 h-5" /> Recent Activity
              </h2>
              <div className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
                {adminData.logs.slice().reverse().map((l: Log) => {
                  const parsed = parseLogDetails(l.details);
                  return (
                    <div key={l.id} className="p-3 bg-white/5 rounded-xl flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex gap-2 items-center flex-wrap mb-1">
                          <span className="text-[9px] font-bold bg-white/10 px-2 py-0.5 rounded uppercase">{l.date}</span>
                          <span className="text-[10px] text-emerald-400 font-bold">
                            @{adminData.users.find((u: UserType) => u.id === l.user_id)?.username || "?"}
                          </span>
                        </div>
                        {parsed && (
                          <div>
                            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded uppercase">{parsed.concept}</span>
                            <p className="text-xs text-white/60 mt-1 line-clamp-2">{parsed.summary}</p>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          fetch(`/api/admin/log/${l.id}`, { method: "DELETE", headers: { Authorization: adminToken } })
                            .then(() => fetchAdminData(adminToken))
                        }
                        className="p-2 text-white/20 hover:text-red-400 ml-3"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <ConfirmModal
            isOpen={adminConfirmModal.isOpen}
            title="Delete User"
            message={`Permanently delete ${adminConfirmModal.userName} and all their data? This cannot be undone.`}
            confirmLabel="Delete User"
            variant="danger"
            onConfirm={() => {
              fetch(`/api/admin/user/${adminConfirmModal.userId}`, {
                method: "DELETE",
                headers: { Authorization: adminToken! },
              }).then(() => {
                fetchAdminData(adminToken!);
                setAdminConfirmModal({ isOpen: false, userId: "", userName: "" });
              });
            }}
            onCancel={() => setAdminConfirmModal({ isOpen: false, userId: "", userName: "" })}
          />
        </div>
      </div>
    );
  }

  // ── Join Screen ──────────────────────────────────────────────────────────────
  if (isJoining) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full bg-[#1A1A1A] p-8 rounded-2xl shadow-xl border border-white/5">
          <div className="flex items-center gap-3 mb-8">
            <AppLogo size="lg" />
            <h1 className="text-2xl font-bold tracking-tight text-white">Learning Tracker</h1>
          </div>

          <form onSubmit={handleJoin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Full Name</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full px-4 py-3 bg-[#2A2A2A] rounded-xl focus:ring-2 focus:ring-white outline-none text-white border-none"
                placeholder="e.g. Vishal Sharma"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">
                Unique Handle (@username)
              </label>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                className="w-full px-4 py-3 bg-[#2A2A2A] rounded-xl focus:ring-2 focus:ring-white outline-none text-white border-none"
                placeholder="vsharma99"
                required
              />
              {handle && cleanedHandle !== handle.toLowerCase().replace(/^@/, "") && (
                <p className="text-[10px] text-yellow-400/80 mt-1.5 ml-1">
                  Will be saved as: <span className="font-bold text-yellow-400">@{cleanedHandle || "..."}</span>
                </p>
              )}
              {handle && !cleanedHandle && (
                <p className="text-[10px] text-red-400 mt-1.5 ml-1">
                  Username must contain at least one letter, number, or underscore.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Room ID (for collaboration)</label>
              <input
                type="text"
                value={inputRoomId}
                onChange={(e) => setInputRoomId(e.target.value)}
                className="w-full px-4 py-3 bg-[#2A2A2A] rounded-xl focus:ring-2 focus:ring-white outline-none text-white border-none"
                placeholder="default"
              />
            </div>

            {joinError && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-bold text-center"
              >
                {joinError}
              </motion.div>
            )}

            <motion.button
              whileHover={{ scale: isLoggingIn ? 1 : 1.02 }}
              whileTap={{ scale: isLoggingIn ? 1 : 0.98 }}
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 bg-white text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoggingIn ? <><Loader2 className="w-4 h-4 animate-spin" /> Preparing...</> : <>Start Preparation <ChevronRight className="w-4 h-4" /></>}
            </motion.button>
          </form>

          <div className="mt-8 pt-6 border-t border-white/5">
            <button
              onClick={() => setIsAdminMode(true)}
              className="w-full text-xs text-white/20 hover:text-white/50 transition-colors uppercase tracking-widest font-bold"
            >
              Admin Access
            </button>
          </div>
        </div>

        {/* Admin Login Modal */}
        <AnimatePresence>
          {isAdminMode && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-[#1A1A1A] w-full max-w-sm p-8 rounded-2xl border border-white/10"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold">Admin Login</h2>
                  <button onClick={() => setIsAdminMode(false)}><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleAdminLogin} className="space-y-4">
                  <input
                    type="text"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    className="w-full px-4 py-3 bg-[#2A2A2A] rounded-xl outline-none text-white border-none"
                    placeholder="Admin Username"
                    autoFocus
                  />
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-[#2A2A2A] rounded-xl outline-none text-white border-none"
                    placeholder="Admin Password"
                  />
                  <button
                    type="submit"
                    disabled={isAdminLoggingIn}
                    className="w-full py-3 bg-white text-black rounded-xl font-bold hover:bg-white/90 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isAdminLoggingIn ? <><Loader2 className="w-4 h-4 animate-spin" />Logging in...</> : "Login"}
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Main App ─────────────────────────────────────────────────────────────────
  const hasBonusToday = user && userTasks.some((t) => {
    const log = state.logs.find((l) => l.user_id === user.id && l.task_id === t.id && l.date === today);
    return log && log.value >= t.target_daily * 5;
  });

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans">
      {/* Offline banner */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-2 flex items-center justify-center gap-2"
          >
            <WifiOff className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-xs font-bold text-yellow-400">
              You're offline. Changes will sync when connection is restored.
              {pendingCount > 0 && ` (${pendingCount} pending)`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-[#1A1A1A] border-b border-white/10 px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <AppLogo size="sm" />
            <span className="font-bold text-base tracking-tight">Learning Tracker</span>
          </div>

          <nav className="hidden md:flex items-center gap-5">
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Users className="w-4 h-4" /> {roomId}
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
              <Flame className="w-4 h-4" /> {myStreak} Day Streak
              {hasBonusToday && (
                <span className="bg-yellow-400 text-black text-[9px] px-1.5 py-0.5 rounded font-black italic uppercase animate-pulse">+Bonus</span>
              )}
            </div>
            <div className="flex items-center gap-3 pl-5 border-l border-white/10">
              <span className="text-xs font-bold text-emerald-400">LVL {myLevel}</span>
              <div className="w-20 h-1.5 bg-[#2A2A2A] rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 transition-all duration-500" style={{ width: `${xpProgress}%` }} />
              </div>
              <span className="text-[10px] text-white/30">{myXP} XP</span>
              <div className="flex gap-1">
                {myBadges.map((b) => (
                  <span key={b.id} title={`${b.name}: ${b.description}`} className="cursor-help text-sm">
                    {b.icon}
                  </span>
                ))}
              </div>
            </div>
            {/* Connection status dot */}
            <div className={`w-2 h-2 rounded-full transition-colors ${isConnected() ? "bg-emerald-400" : "bg-yellow-400 animate-pulse"}`} title={isConnected() ? "Connected" : "Reconnecting..."} />
          </nav>

          {/* Mobile streak */}
          <div className="flex md:hidden items-center gap-2">
            <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full">
              <Flame className="w-3 h-3" /> {myStreak}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-bold">{user?.name}</div>
            <div className="text-[10px] text-white/40">@{user?.username}</div>
          </div>
          <button
            onClick={() => setIsProfileOpen(true)}
            className="p-2 hover:bg-white/5 rounded-full transition-colors"
            title="Profile & Settings"
          >
            <User className="w-5 h-5" />
          </button>
          <button
            onClick={handleLogout}
            className="p-2 hover:bg-white/5 rounded-full transition-colors"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6 pb-24 md:pb-6">
        {/* Tabs */}
        <div className="hidden md:flex gap-1 border-b border-white/10 pb-0 overflow-x-auto no-scrollbar">
          {[
            { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-3.5 h-3.5" />, badge: null },
            { key: "journal", label: "Journal", icon: <BookOpen className="w-3.5 h-3.5" />, badge: journalEntryCount > 0 ? journalEntryCount : null },
            { key: "weekly", label: "Weekly", icon: <Zap className="w-3.5 h-3.5" />, badge: null },
          ].map(({ key, label, icon, badge }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as any)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-t-lg border-b-2 transition-all whitespace-nowrap ${
                activeTab === key
                  ? "border-emerald-400 text-emerald-400"
                  : "border-transparent text-white/50 hover:text-white hover:border-white/20"
              }`}
            >
              {icon} {label}
              {badge !== null && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ml-0.5 ${
                  activeTab === key ? "bg-emerald-400/20 text-emerald-400" : "bg-white/10 text-white/40"
                }`}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Dashboard Tab ──────────────────────────────────────────────────── */}
        {activeTab === "dashboard" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Tasks */}
            <div className="lg:col-span-8 space-y-6">
              {/* Heatmap */}
              <div className="bg-[#1A1A1A] rounded-2xl border border-white/10 p-6 overflow-hidden" ref={containerRef}>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-serif italic text-xl">Consistency Matrix</h2>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-white/30">
                    <span>Less</span>
                    {["bg-[#2A2A2A]", "bg-[#064e3b]", "bg-[#059669]", "bg-[#10b981]", "bg-[#34d399]"].map((c, i) => (
                      <div key={i} className={`w-2.5 h-2.5 ${c} rounded-sm`} />
                    ))}
                    <span>More</span>
                  </div>
                </div>

                <HeatmapTooltip>
                  {(showTooltip, hideTooltip) => (
                    <div ref={heatmapScrollRef} className="overflow-x-auto pb-2 no-scrollbar flex gap-[3px]">
                      {/* Day labels */}
                      <div className="flex flex-col gap-[3px] pr-2 text-[9px] text-white/30 font-bold pt-5">
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                          <span key={d} className={`h-[10px] flex items-center leading-none ${i % 2 !== 0 ? "" : "opacity-0"}`}>{d}</span>
                        ))}
                      </div>
                      {/* Grid */}
                      <div className="flex gap-[3px] pt-5">
                        {Array.from({ length: Math.ceil(lastDays.length / 7) }).map((_, colIdx) => {
                          const weekDays = lastDays.slice(colIdx * 7, colIdx * 7 + 7);
                          const firstDay = weekDays[0];
                          let monthLabel = null;
                          if (firstDay && new Date(firstDay + "T12:00:00").getDate() <= 7) {
                            const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                            monthLabel = m[new Date(firstDay + "T12:00:00").getMonth()];
                          }
                          return (
                            <div key={colIdx} className="relative flex flex-col gap-[3px]">
                              {monthLabel && (
                                <span className="absolute -top-5 left-0 text-[10px] text-white/30 font-bold whitespace-nowrap">{monthLabel}</span>
                              )}
                              {weekDays.map((date) => {
                                const data = activityMap[date] || { intensity: 0, completedCount: 0, totalMandatory: 0, hasBonus: false, taskBreakdown: [] };
                                const colors = ["bg-[#2A2A2A]", "bg-[#064e3b]", "bg-[#059669]", "bg-[#10b981]", "bg-[#34d399]"];
                                const bgClass = data.hasBonus ? "bg-[#fbbf24]" : colors[data.intensity];
                                return (
                                  <button
                                    key={date}
                                    onClick={() => setSelectedDate(date)}
                                    onMouseEnter={(e) => showTooltip(e, { date, ...data })}
                                    onMouseLeave={hideTooltip}
                                    className={`w-[10px] h-[10px] rounded-[2px] transition-all hover:scale-125 hover:ring-1 hover:ring-white/50 border ${date === selectedDate ? "border-white" : "border-black/10"} ${bgClass}`}
                                  />
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </HeatmapTooltip>
              </div>

              {/* Date Selector */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <ChevronRight className="w-5 h-5 text-emerald-400" />
                    {selectedDate === today ? "Today's Tasks" : `Tasks — ${selectedDate}`}
                  </h2>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar items-center">
                    {/* Streak freeze button */}
                    {canFreeze && selectedDate !== today && (() => {
                      const dayData = activityMap[selectedDate];
                      if (!dayData) return true; // no data = show button
                      return dayData.completedCount < dayData.totalMandatory; // show if not ALL tasks complete
                    })() && (
                      <button
                        onClick={() => useStreakFreeze(selectedDate)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-400 text-[10px] font-bold hover:bg-blue-500/20 transition-colors whitespace-nowrap"
                        title="Use streak freeze on this day"
                      >
                        <Snowflake className="w-3 h-3" /> Freeze Day
                      </button>
                    )}
                    {lastDays.slice(-7).map((date) => (
                      <button
                        key={date}
                        onClick={() => setSelectedDate(date)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                          selectedDate === date ? "bg-white text-black" : "bg-white/5 text-white/40 hover:bg-white/10"
                        }`}
                      >
                        {date === today ? "Today" : date.split("-").slice(1).join("/")}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {userTasks.map((task) => {
                    const log = state.logs.find((l) => l.user_id === user?.id && l.task_id === task.id && l.date === selectedDate);
                    const value = log?.value || 0;
                    const progress = Math.min(100, (value / task.target_daily) * 100);
                    const isUltraBonus = value >= task.target_daily * 5;

                    return (
                      <div
                        key={task.id}
                        className={`bg-[#1A1A1A] p-5 rounded-2xl border border-white/5 relative overflow-hidden group transition-all hover:border-white/15 ${isUltraBonus ? "ring-2 ring-yellow-500/50 shadow-[0_0_20px_rgba(245,158,11,0.15)]" : ""}`}
                      >
                        {isUltraBonus && (
                          <div className="absolute -top-0 -right-0 bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 px-3 py-1 rounded-bl-xl flex items-center gap-1">
                            <Zap className="w-3 h-3 text-white fill-white" />
                            <span className="text-[9px] font-black italic text-white uppercase">5× Bonus</span>
                          </div>
                        )}

                        <div className="flex justify-between items-start mb-4">
                          <div className="flex gap-2">
                            <div className="p-2.5 bg-[#2A2A2A] rounded-xl group-hover:bg-white group-hover:text-black transition-all">
                              {task.type === "sql" && <Database className="w-4 h-4" />}
                              {task.type === "pyspark" && <Terminal className="w-4 h-4" />}
                              {task.type === "project" && <Briefcase className="w-4 h-4" />}
                              {task.type === "custom" && <Settings2 className="w-4 h-4" />}
                            </div>
                            <button
                              onClick={() => deleteTask(task.id)}
                              className="p-2.5 bg-[#2A2A2A] rounded-xl text-red-400/60 hover:bg-red-400 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="text-right">
                            <span className="text-2xl font-bold font-mono">{value}</span>
                            <span className="text-white/30 text-xs"> / {task.target_daily}</span>
                          </div>
                        </div>

                        <h3 className="font-bold text-sm mb-1">{task.title}</h3>
                        <p className="text-[10px] text-white/30 uppercase tracking-wider mb-4">Daily Target</p>

                        <div className="flex gap-2">
                          <button
                            onClick={() => updateLog(task.id, selectedDate, Math.max(0, value - 1))}
                            className="flex-1 py-2 bg-[#2A2A2A] rounded-lg text-sm font-bold hover:bg-white/10 transition-colors"
                          >
                            −
                          </button>
                          <button
                            onClick={() => {
                              setActiveLogTask({ task, date: selectedDate });
                              const parsed = parseLogDetails(log?.details);
                              setLogConcept(parsed?.concept || "");
                              setLogSummary(parsed?.summary || "");
                              setLogValue(log?.value ?? 1);
                            }}
                            className="flex-[2] py-2 bg-white text-black rounded-lg text-sm font-bold hover:bg-white/90 transition-all flex items-center justify-center gap-1.5"
                          >
                            <Plus className="w-4 h-4" /> {log ? "Update" : "Log Progress"}
                          </button>
                        </div>

                        <div className="mt-3 h-1 w-full bg-[#2A2A2A] rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                        </div>

                        {log?.details && (
                          <div className="mt-3 p-3 bg-[#2A2A2A] rounded-lg text-[10px] text-white/50 flex items-start justify-between gap-2 group/details">
                            <div className="flex items-start gap-2 w-full">
                              <Info className="w-3 h-3 mt-0.5 shrink-0" />
                              {(() => {
                                const parsed = parseLogDetails(log.details);
                                if (!parsed) return <span>{log.details}</span>;
                                return (
                                  <div className="flex flex-col gap-1 flex-1">
                                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded uppercase tracking-wider w-fit">{parsed.concept}</span>
                                    <span className="text-[11px] text-white/60 line-clamp-2 leading-relaxed">{parsed.summary}</span>
                                  </div>
                                );
                              })()}
                            </div>
                            <button
                              onClick={() => {
                                setActiveLogTask({ task, date: selectedDate });
                                const parsed = parseLogDetails(log.details);
                                setLogConcept(parsed?.concept || "");
                                setLogSummary(parsed?.summary || "");
                                setLogValue(log.value);
                              }}
                              className="opacity-0 group-hover/details:opacity-100 p-1 hover:bg-white/10 rounded transition-all"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add task / template buttons */}
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => setIsAddTaskModalOpen(true)}
                      className="flex-1 border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center p-5 text-white/30 hover:text-white hover:border-white/30 transition-all gap-2 min-h-[120px]"
                    >
                      <Plus className="w-6 h-6" />
                      <span className="font-bold text-xs uppercase tracking-widest">Add Custom Goal</span>
                    </button>
                    <button
                      onClick={() => setIsTemplatesOpen(true)}
                      className="border border-dashed border-white/10 rounded-xl flex items-center justify-center gap-2 py-2.5 text-white/30 hover:text-white hover:border-white/30 transition-all"
                    >
                      <Layers className="w-4 h-4" />
                      <span className="font-bold text-[11px] uppercase tracking-widest">Use Template</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Collaboration & Leaderboard */}
            <div className="lg:col-span-4 space-y-5">
              <div className="bg-[#1A1A1A] rounded-2xl p-5 border border-white/5">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-serif italic text-lg">Collaborators</h2>
                  <Share2 className="w-4 h-4 text-white/30" />
                </div>
                <div className="space-y-3">
                  {state.users.map((u) => {
                    const uStreak = getStreak(u.id, state.tasks, state.logs, state.streakFreezes);
                    return (
                      <div key={u.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-blue-500 flex items-center justify-center text-[10px] font-bold text-white">
                            {u.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm font-bold">{u.name} {u.id === user?.id && <span className="text-white/30 text-[10px]">(You)</span>}</div>
                            <div className="text-[10px] text-white/30 uppercase tracking-wider">{uStreak} day streak</div>
                          </div>
                        </div>
                        {uStreak > 0 && <Flame className="w-4 h-4 text-orange-400" />}
                      </div>
                    );
                  })}

                  {/* Show invite hint when user is alone */}
                  {state.users.length <= 1 && (
                    <div className="mt-2 p-3 border border-dashed border-white/10 rounded-xl">
                      <p className="text-[10px] text-white/30 mb-2 leading-relaxed">
                        Invite a teammate — share your Room ID and they join with the same ID on the login screen.
                      </p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(roomId).then(() => {
                            setRoomIdCopied(true);
                            setTimeout(() => setRoomIdCopied(false), 2000);
                          }).catch(() => {});
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors group"
                        title="Click to copy Room ID"
                      >
                        <span className="text-[11px] font-bold text-white/60 group-hover:text-white transition-colors font-mono">
                          {roomId}
                        </span>
                        <span className={`text-[9px] uppercase tracking-widest transition-colors ${roomIdCopied ? "text-emerald-400" : "text-white/30 group-hover:text-emerald-400"}`}>
                          {roomIdCopied ? "Copied!" : "Copy"}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-[#1A1A1A] rounded-2xl p-5 border border-white/5">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-bold flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-yellow-500" /> Global Leaderboard
                  </h2>
                  <span className="text-[10px] text-white/30 uppercase tracking-widest">Top 5</span>
                </div>
                <div className="space-y-3">
                  {leaderboard.length > 0 ? (
                    leaderboard.map((entry, i) => {
                      const league = getLeagueInfo(i);
                      return (
                        <div key={`${entry.username}-${i}`} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-xl">{league.name.split(" ")[0]}</span>
                            <div>
                              <div className="text-sm font-bold">{entry.name}</div>
                              <div className={`text-[10px] font-bold ${league.color}`}>{league.name.split(" ").slice(1).join(" ")}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 bg-emerald-500/10 px-2 py-1 rounded-lg">
                            <Flame className="w-3 h-3 text-emerald-500" />
                            <span className="text-sm font-bold text-emerald-500">{entry.streak}</span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-white/20">
                      <Medal className="w-8 h-8 mx-auto mb-2 opacity-20" />
                      <p className="text-xs font-bold uppercase tracking-widest">No streaks yet</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Journal Tab ─────────────────────────────────────────────────────── */}
        {activeTab === "journal" && (
          <ErrorBoundary>
            <div className="space-y-5">
              <div className="flex flex-col items-center text-center md:flex-row md:items-start md:text-left md:justify-between">
                <div>
                  <h1 className="text-xl font-bold flex items-center justify-center md:justify-start gap-2">
                    <BookOpen className="w-5 h-5 text-emerald-400" />
                    Learning Journal
                  </h1>
                  <p className="text-[11px] text-white/30 mt-0.5">Your Feynman notes and concept logs, searchable and filterable.</p>
                </div>
              </div>
              <JournalView logs={state.logs} tasks={state.tasks} userId={user?.id || ""} />
            </div>
          </ErrorBoundary>
        )}

        {/* ── Weekly Tab ──────────────────────────────────────────────────────── */}
        {activeTab === "weekly" && (
          <ErrorBoundary>
            <div className="space-y-5">
              <div className="flex flex-col items-center text-center md:flex-row md:items-start md:text-left md:justify-between">
                <div>
                  <h1 className="text-xl font-bold flex items-center justify-center md:justify-start gap-2">
                    <Zap className="w-5 h-5 text-emerald-400" />
                    Weekly Digest
                  </h1>
                  <p className="text-[11px] text-white/30 mt-0.5">Auto-generated review comparing this week vs last week.</p>
                </div>
              </div>
              <WeeklySummary logs={state.logs} tasks={state.tasks} userId={user?.id || ""} />
            </div>
          </ErrorBoundary>
        )}
      </main>

      {/* ── Add Task Modal ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isAddTaskModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-[#1A1A1A] w-full max-w-md rounded-2xl border border-white/10 overflow-hidden"
            >
              <div className="p-5 border-b border-white/5 flex items-center justify-between">
                <h3 className="font-bold">Add Custom Goal</h3>
                <button onClick={() => setIsAddTaskModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">Goal Title</label>
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && newTaskTitle.trim() && (addTask(newTaskTitle, "custom", parseInt(newTaskTarget) || 1), setIsAddTaskModalOpen(false), setNewTaskTitle(""), setNewTaskTarget("1"))}
                    className="w-full px-4 py-3 bg-[#2A2A2A] rounded-xl outline-none text-white border-none focus:ring-2 focus:ring-white"
                    placeholder="e.g. Read Spark docs for 30 min"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">Daily Target (number)</label>
                  <input
                    type="number"
                    value={newTaskTarget}
                    onChange={(e) => setNewTaskTarget(e.target.value)}
                    className="w-full px-4 py-3 bg-[#2A2A2A] rounded-xl outline-none text-white border-none focus:ring-2 focus:ring-white"
                    min="1" max="100"
                  />
                </div>
                <button
                  onClick={() => {
                    if (newTaskTitle.trim()) {
                      addTask(newTaskTitle, "custom", parseInt(newTaskTarget) || 1);
                      setIsAddTaskModalOpen(false);
                      setNewTaskTitle("");
                      setNewTaskTarget("1");
                    }
                  }}
                  disabled={!newTaskTitle.trim()}
                  className="w-full py-3 bg-white text-black rounded-xl font-bold hover:bg-white/90 transition-all disabled:opacity-40"
                >
                  Add Goal
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Log Modal ───────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {activeLogTask && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-[#1A1A1A] w-full max-w-md rounded-2xl border border-white/10 overflow-hidden"
            >
              <div className="p-5 border-b border-white/5 flex items-center justify-between">
                <h3 className="font-bold">Log Progress</h3>
                <button onClick={() => setActiveLogTask(null)} className="p-2 hover:bg-white/5 rounded-full">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-1">Task</label>
                  <div className="font-bold text-sm">{activeLogTask.task.title}</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">Progress Count</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setLogValue((p) => Math.max(0, p - 1))} className="p-2 bg-[#2A2A2A] rounded-lg hover:bg-white/10 transition-colors font-bold w-10">−</button>
                    <input
                      type="number"
                      value={logValue}
                      onChange={(e) => setLogValue(parseInt(e.target.value) || 0)}
                      className="flex-1 px-4 py-2 bg-[#2A2A2A] rounded-xl outline-none text-white text-center font-bold border-none focus:ring-2 focus:ring-white"
                    />
                    <button onClick={() => setLogValue((p) => p + 1)} className="p-2 bg-[#2A2A2A] rounded-lg hover:bg-white/10 transition-colors font-bold w-10">+</button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">
                    Core Concept <span className="text-white/20 normal-case">(what did you focus on?)</span>
                  </label>
                  <input
                    type="text"
                    autoFocus
                    maxLength={50}
                    value={logConcept}
                    onChange={(e) => setLogConcept(e.target.value)}
                    className="w-full px-4 py-3 bg-[#2A2A2A] rounded-xl outline-none text-white border-none focus:ring-2 focus:ring-white"
                    placeholder="e.g. Window functions, Joins, Aggregations"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">
                    Key Takeaway / Biggest Blocker
                  </label>
                  <textarea
                    value={logSummary}
                    onChange={(e) => setLogSummary(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && logConcept.trim() && logSummary.trim()) {
                        handleLogSubmit();
                      }
                    }}
                    className="w-full px-4 py-3 bg-[#2A2A2A] rounded-xl outline-none text-white border-none focus:ring-2 focus:ring-white min-h-[80px] resize-none"
                    placeholder="Explain it simply. What clicked? What blocked you?"
                  />
                  <div className="text-[10px] text-white/20 mt-1 text-right">Ctrl+Enter to submit</div>
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setActiveLogTask(null)}
                    className="flex-1 py-3 bg-white/5 rounded-xl font-bold text-sm hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleLogSubmit}
                    disabled={!logConcept.trim() || !logSummary.trim()}
                    className="flex-[2] py-3 bg-white text-black rounded-xl font-bold text-sm hover:bg-white/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Confirm & Log
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Confirm Modal ───────────────────────────────────────────────────── */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmLabel="Delete"
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((p) => ({ ...p, isOpen: false }))}
      />

      {/* ── Profile Modal ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isProfileOpen && user && token && (
          <ProfileSettings
            user={user}
            token={token}
            onClose={() => setIsProfileOpen(false)}
            onUpdate={(newName, newRoomId, newToken) => {
              const updated = { ...user, name: newName, room_id: newRoomId };
              setUser(updated);
              setToken(newToken);
              setRoomId(newRoomId);
              saveSession(user.id, newToken, updated, newRoomId);
              fetchState(newRoomId);
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Task Templates Modal ────────────────────────────────────────────── */}
      <TaskTemplates
        isOpen={isTemplatesOpen}
        onClose={() => setIsTemplatesOpen(false)}
        onApply={(tasks) => {
          tasks.forEach((t) => addTask(t.title, t.type, t.target));
        }}
      />

      {/* ── Mobile bottom nav ───────────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#1A1A1A]/95 backdrop-blur-md border-t border-white/10 px-2 pb-4 sm:pb-safe">
        <div className="flex items-center justify-around">
          {[
            { key: "dashboard", label: "Today", icon: <LayoutDashboard className="w-5 h-5" /> },
            { key: "journal", label: "Journal", icon: <BookOpen className="w-5 h-5" /> },
            { key: "weekly", label: "Weekly", icon: <Zap className="w-5 h-5" /> },
          ].map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as any)}
              className={`flex flex-col items-center gap-0.5 px-4 py-3 transition-all ${
                activeTab === key ? "text-emerald-400" : "text-white/30"
              }`}
            >
              {icon}
              <span className="text-[9px] font-bold uppercase tracking-widest">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}