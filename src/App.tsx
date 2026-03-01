/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Brain,
  Database,
  Terminal,
  Briefcase,
  Plus,
  Users,
  Flame,
  LogOut,
  Share2,
  X,
  Info,
  Trash2,
  Edit2,
  Settings2,
  Trophy,
  Medal,
  Zap,
  ChevronRight,
  ChevronLeft,
  Loader2
} from 'lucide-react';
import { cn, User, Task, Log, AppState } from './types';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { calculateXP, calculateLevel, calculateBadges, getLeagueInfo } from './utils/gamification';

const parseLogDetails = (detailsString?: string) => {
  if (!detailsString) return null;
  try {
    const parsed = JSON.parse(detailsString);
    if (parsed.concept && parsed.summary) return parsed;
    return { concept: 'General', summary: detailsString };
  } catch (e) {
    return { concept: 'Note', summary: detailsString }; // Fallback for old plain-text logs
  }
};

const AppLogo = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
  const iconSizes = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6"
  };
  const containerPadding = {
    sm: "p-1.5",
    md: "p-2",
    lg: "p-3"
  };

  return (
    <div className={`bg-white rounded-xl shadow-sm flex items-center justify-center ${containerPadding[size]}`}>
      <Brain className={`text-black ${iconSizes[size]}`} />
    </div>
  );
};

// Responsive constants
const GET_DAYS_TO_SHOW = () => window.innerWidth < 768 ? 91 : 371; // 13 weeks vs 53 weeks

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'analytics'>('dashboard');
  const [user, setUser] = useState<User | null>(null);
  const [roomId, setRoomId] = useState<string>('default');
  const [state, setState] = useState<AppState>({ users: [], tasks: [], logs: [] });
  const [isJoining, setIsJoining] = useState(true);
  const [userName, setUserName] = useState('');
  const [handle, setHandle] = useState('');
  const [inputRoomId, setInputRoomId] = useState('default');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 400 });
  const [daysToShow, setDaysToShow] = useState(GET_DAYS_TO_SHOW());
  const containerRef = useRef<HTMLDivElement>(null);
  const heatmapScrollRef = useRef<HTMLDivElement>(null);

  // Selected Date for logging/viewing
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  // Modals State
  const [activeLogTask, setActiveLogTask] = useState<{ task: Task; date: string } | null>(null);
  const [logConcept, setLogConcept] = useState('');
  const [logSummary, setLogSummary] = useState('');
  const [logValue, setLogValue] = useState<number>(1);
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskTarget, setNewTaskTarget] = useState('1');

  useEffect(() => {
    console.log("App mounted. Checking session...");
    try {
      const savedUser = localStorage.getItem('learning_tracker_user');
      const savedRoomId = localStorage.getItem('learning_tracker_room_id');
      if (savedUser && savedRoomId) {
        const u = JSON.parse(savedUser);
        if (u && u.id) {
          setUser(u);
          setRoomId(savedRoomId);
          setIsJoining(false);
          connectSocket(u.id, savedRoomId);
          fetchState(savedRoomId);
        }
      }
    } catch (e) {
      console.error("Session restore error:", e);
      localStorage.removeItem('learning_tracker_user');
      localStorage.removeItem('learning_tracker_room_id');
    }
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  // Admin State
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);
  const [adminData, setAdminData] = useState<{ users: User[], tasks: Task[], logs: Log[], rooms: any[] } | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      setLeaderboard(data.leaderboard || []);
    } catch (err) {
      console.error("Failed to fetch leaderboard", err);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // Handle Resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setCanvasSize({
          width: containerRef.current.offsetWidth,
          height: 400
        });
        setDaysToShow(GET_DAYS_TO_SHOW());
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Initialize User & Socket
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;

    setJoinError(null);
    setIsLoggingIn(true);
    try {
      const res = await fetch('/api/init-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: userName, roomId: inputRoomId, username: handle })
      });
      const data = await res.json();

      if (!res.ok) {
        setJoinError(data.error || 'Failed to join');
        setIsLoggingIn(false);
        return;
      }

      if (data.success) {
        const userId = data.userId;
        const newUser = { id: userId, name: userName, room_id: inputRoomId, username: handle };
        setUser(newUser);
        setRoomId(inputRoomId);
        setIsJoining(false);

        localStorage.setItem('learning_tracker_user', JSON.stringify(newUser));
        localStorage.setItem('learning_tracker_room_id', inputRoomId);

        connectSocket(userId, inputRoomId);
        fetchState(inputRoomId);
      }
    } catch (err) {
      setJoinError('Connection error. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('learning_tracker_user');
    localStorage.removeItem('learning_tracker_room_id');
    setUser(null);
    setRoomId('default');
    setUserName('');
    setIsJoining(true);
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  };

  const connectSocket = (userId: string, rId: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'join', userId, roomId: rId }));
    };

    socket.onclose = () => {
      console.log("WebSocket disconnected");
      socketRef.current = null;
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'log_updated') {
        setState(prev => {
          const newLogs = [...prev.logs];
          const index = newLogs.findIndex(l =>
            l.user_id === message.payload.userId &&
            l.task_id === message.payload.taskId &&
            l.date === message.payload.date
          );
          if (index > -1) {
            newLogs[index] = { ...newLogs[index], value: message.payload.value, details: message.payload.details };
          } else {
            newLogs.push({
              id: Date.now(),
              user_id: message.payload.userId,
              task_id: message.payload.taskId,
              date: message.payload.date,
              value: message.payload.value,
              details: message.payload.details
            });
          }
          return { ...prev, logs: newLogs };
        });
      }
      if (message.type === 'task_added') {
        setState(prev => {
          if (prev.tasks.some(t => t.id === message.payload.id)) return prev;
          return {
            ...prev,
            tasks: [...prev.tasks, {
              id: message.payload.id,
              user_id: message.payload.userId,
              title: message.payload.title,
              type: message.payload.type,
              target_daily: message.payload.targetDaily
            }]
          };
        });
      }
      if (message.type === 'task_deleted') {
        setState(prev => ({
          ...prev,
          tasks: prev.tasks.filter(t => t.id !== message.payload.taskId),
          logs: prev.logs.filter(l => l.task_id !== message.payload.taskId)
        }));
      }
    };
  };

  const fetchState = async (rId: string) => {
    const res = await fetch(`/api/state/${rId}`);
    const data = await res.json();
    setState(data);
  };

  const updateLog = (taskId: string, date: string, value: number, details?: string) => {
    if (!user || !socketRef.current) return;
    socketRef.current.send(JSON.stringify({
      type: 'update_log',
      payload: { userId: user.id, taskId, date, value, details }
    }));

    // Local update for immediate feedback
    setState(prev => {
      const newLogs = [...prev.logs];
      const index = newLogs.findIndex(l => l.user_id === user.id && l.task_id === taskId && l.date === date);
      if (index > -1) {
        newLogs[index] = { ...newLogs[index], value, details };
      } else {
        newLogs.push({ id: Date.now(), user_id: user.id, task_id: taskId, date, value, details });
      }
      return { ...prev, logs: newLogs };
    });

    const task = state.tasks.find(t => t.id === taskId);
    if (value > 0) {
      const isMega = task && value >= task.target_daily * 5;
      confetti({
        particleCount: isMega ? 150 : 50,
        spread: isMega ? 100 : 60,
        origin: { y: 0.8 },
        colors: isMega ? ['#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6'] : ['#10b981', '#3b82f6', '#f59e0b'],
        scalar: isMega ? 1.5 : 1
      });
    }
  };

  const addTask = (title: string, type: Task['type'], targetDaily: number) => {
    if (!user || !socketRef.current) return;
    socketRef.current.send(JSON.stringify({
      type: 'add_task',
      payload: { userId: user.id, title, type, targetDaily }
    }));
  };

  const deleteTask = (taskId: string) => {
    if (!user || !socketRef.current) {
      console.error("Cannot delete: user or socket missing", { user, socket: !!socketRef.current });
      return;
    }
    if (confirm('Are you sure you want to delete this task? (This will also delete all progress logs for it)')) {
      console.log("Sending delete_task message for:", taskId);
      socketRef.current.send(JSON.stringify({
        type: 'delete_task',
        payload: { taskId }
      }));
    }
  };

  const today = new Date().toISOString().split('T')[0];
  const lastDays = useMemo(() => {
    const days = [];
    // Ensure we start from a Sunday to align the grid perfectly
    const d = new Date();
    // Find the current day of the week (0=Sun, 1=Mon, ..., 6=Sat)
    const dayOfWeek = d.getDay();
    // We want the total days to be a multiple of 7 to fill the columns
    const numColumns = Math.ceil(daysToShow / 7);
    const totalDays = numColumns * 7;

    // We subtract 'dayOfWeek' to ensure the last day in the grid is a Saturday or today
    // Actually, GitHub's last column is usually the current week.
    // If today is Wednesday, the last column will have 4 entries (Sun, Mon, Tue, Wed).
    for (let i = totalDays - (7 - (dayOfWeek + 1)); i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    return days;
  }, [daysToShow]);

  const activityMap = useMemo(() => {
    const map: Record<string, { intensity: number, completedCount: number, totalMandatory: number, hasBonus: boolean }> = {};
    if (!user) return map;

    const userTasksForMap = state.tasks.filter(t => t.user_id === user.id);
    const userLogs = state.logs.filter(l => l.user_id === user.id);

    lastDays.forEach(date => {
      const dayLogs = userLogs.filter(l => l.date === date);
      let intensity = 0;
      let completedCount = 0;
      let hasBonus = false;

      if (userTasksForMap.length > 0) {
        completedCount = userTasksForMap.filter(t => {
          const log = dayLogs.find(l => l.task_id === t.id);
          return (log?.value || 0) >= t.target_daily;
        }).length;

        const ratio = completedCount / userTasksForMap.length;
        if (completedCount === 0 && dayLogs.some(l => l.value > 0)) intensity = 1;
        else if (ratio > 0 && ratio < 0.5) intensity = 2;
        else if (ratio >= 0.5 && ratio < 1) intensity = 3;
        else if (ratio === 1) intensity = 4;

        hasBonus = userTasksForMap.some(t => {
          const log = dayLogs.find(l => l.task_id === t.id);
          return log && log.value >= t.target_daily * 5;
        });
      }

      map[date] = { intensity, completedCount, totalMandatory: userTasksForMap.length, hasBonus };
    });

    return map;
  }, [state.tasks, state.logs, user, lastDays]);

  // Auto-scroll heatmap to the right (most recent)
  useEffect(() => {
    const scrollToRight = () => {
      if (heatmapScrollRef.current) {
        heatmapScrollRef.current.scrollLeft = heatmapScrollRef.current.scrollWidth;
      }
    };

    // Attempt multiple times to guarantee post-render execution after widths compute
    requestAnimationFrame(() => {
      scrollToRight();
      setTimeout(scrollToRight, 50);
      setTimeout(scrollToRight, 150);
      setTimeout(scrollToRight, 350);
    });
  }, [daysToShow, activeTab, lastDays]);

  const userTasks = state.tasks.filter(t => t.user_id === user?.id);

  const getStreak = (userId: string) => {
    const userTasks = state.tasks.filter(t => t.user_id === userId);
    // Mandatory tasks can vary per day now. Logic needs to check each date.
    const datesWithLogs = state.logs
      .filter(l => l.user_id === userId)
      .map(l => l.date);

    const uniqueDates = [...new Set(datesWithLogs)].sort().reverse() as string[];
    const completedDates: { date: string, points: number }[] = [];

    for (const date of uniqueDates) {
      const dayTasks = userTasks.map(task => {
        const log = state.logs.find(l => l.user_id === userId && l.task_id === task.id && l.date === date);
        return { target: task.target_daily, value: log?.value || 0 };
      });

      const isAnyTaskComplete = dayTasks.some(t => t.value >= t.target);
      if (isAnyTaskComplete) {
        const isBonusEarned = dayTasks.some(t => t.value >= t.target * 5);
        completedDates.push({ date, points: isBonusEarned ? 2 : 1 });
      }
    }

    // console.log(`Streak Debug [${userId}]:`, { completedDates, uniqueDates });

    let streak = 0;
    const now = new Date();
    // Midday UTC for absolute stability in diff calculations
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0));
    let current = today;

    for (let i = 0; i < completedDates.length; i++) {
      const [y, m, d] = completedDates[i].date.split('-').map(Number);
      const logDate = new Date(Date.UTC(y as number, (m as number) - 1, d as number, 12, 0, 0));

      const diff = Math.floor((current.getTime() - logDate.getTime()) / (1000 * 3600 * 24));
      if (diff <= 1) {
        streak += completedDates[i].points;
        current = logDate;
      } else {
        break;
      }
    }
    return streak;
  };

  const handleLogSubmit = () => {
    if (activeLogTask) {
      const structuredDetails = JSON.stringify({
        concept: logConcept.trim(),
        summary: logSummary.trim()
      });
      updateLog(activeLogTask.task.id, activeLogTask.date, logValue, structuredDetails);
      setActiveLogTask(null);
      setLogConcept('');
      setLogSummary('');
      setLogValue(1);
    }
  };

  const fetchAdminData = async (token: string) => {
    console.log("Fetching admin data with token:", token);
    try {
      const res = await fetch('/api/admin/data', {
        headers: { 'Authorization': token }
      });
      console.log("Admin data response status:", res.status);
      if (res.ok) {
        const data = await res.json();
        console.log("Admin data received:", data);
        setAdminData(data);
      } else {
        const errText = await res.text();
        console.error("Failed to fetch admin data:", errText);
        alert(`Failed to fetch admin data: ${errText}`);
        setAdminToken(null); // Reset on failure
      }
    } catch (err) {
      console.error("Error fetching admin data:", err);
      alert("Error connecting to admin API");
      setAdminToken(null);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdminLoggingIn(true);
    console.log("Attempting admin login for:", adminUsername);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminUsername, password: adminPassword })
      });
      console.log("Admin login response status:", res.status);
      if (res.ok) {
        const data = await res.json();
        console.log("Admin login success, token received");
        setAdminToken(data.token);
        await fetchAdminData(data.token);
      } else {
        const errData = await res.json().catch(() => ({ error: "Unknown error" }));
        console.error("Admin login failed:", errData);
        alert(`Invalid Admin Credentials: ${errData.error || 'Check username/password'}`);
      }
    } catch (err) {
      console.error("Admin login network error:", err);
      alert("Connection error. Please check if the server is running.");
    } finally {
      setIsAdminLoggingIn(false);
    }
  };

  const deleteUser = async (id: string) => {
    if (!adminToken || !confirm("Delete user and all their data?")) return;
    console.log("Deleting user:", id);
    try {
      const res = await fetch(`/api/admin/user/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': adminToken }
      });
      if (res.ok) {
        console.log("User deleted successfully");
        await fetchAdminData(adminToken);
        alert("User deleted successfully!");
      } else {
        console.error("Failed to delete user:", await res.text());
        alert("Failed to delete user");
      }
    } catch (err) {
      console.error("Error deleting user:", err);
      alert("Error deleting user");
    }
  };

  const deleteLog = async (id: number) => {
    if (!adminToken) return;
    await fetch(`/api/admin/log/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': adminToken }
    });
    fetchAdminData(adminToken);
  };

  const handleAddTaskSubmit = () => {
    if (newTaskTitle.trim()) {
      addTask(newTaskTitle, 'custom', parseInt(newTaskTarget) || 1);
      setIsAddTaskModalOpen(false);
      setNewTaskTitle('');
      setNewTaskTarget('1');
    }
  };

  const aggregatedData = useMemo(() => {
    if (!user) return [];
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const userLogs = state.logs.filter(l => l.user_id === user.id);
    const mapped = days.map((day, idx) => {
      const total = userLogs.filter(l => new Date(l.date).getDay() === idx).reduce((acc, l) => acc + (l.value || 0), 0);
      return { name: day.substring(0, 3), volume: total };
    });
    return [...mapped.slice(1), mapped[0]]; // Mon ... Sun
  }, [state.logs, user]);

  const pieData = useMemo(() => {
    if (!user) return [];
    const userLogs = state.logs.filter(l => l.user_id === user.id);
    const types = ['sql', 'pyspark', 'project', 'custom'];
    return types.map(type => {
      const userTasksOfType = state.tasks.filter(t => t.user_id === user.id && t.type === type).map(t => t.id);
      const value = userLogs.filter(l => userTasksOfType.includes(l.task_id)).reduce((acc, l) => acc + (l.value || 0), 0);
      return { name: type.toUpperCase(), value };
    }).filter(d => d.value > 0);
  }, [state.logs, state.tasks, user]);

  const COLORS: Record<string, string> = { SQL: '#3b82f6', PYSPARK: '#f59e0b', PROJECT: '#8b5cf6', CUSTOM: '#10b981' };

  if (adminToken && adminData) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white p-8 font-sans">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 md:mb-12 gap-4"
          >
            <div className="flex items-center gap-4">
              <AppLogo size="lg" />
              <h1 className="text-xl sm:text-3xl font-bold tracking-tight">Admin Dashboard</h1>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => { setAdminToken(null); setIsAdminMode(false); setAdminData(null); }}
              className="px-4 py-2 sm:px-6 sm:py-3 bg-[#ffffff1a] rounded-xl hover:bg-[#ffffff33] text-sm sm:text-base font-bold transition-colors flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" /> Exit
            </motion.button>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-[#1A1A1A] p-6 rounded-2xl border border-[#ffffff1a] shadow-2xl">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-emerald-400">
                  <Users className="w-5 h-5" /> Active Users
                </h2>
                <div className="space-y-3">
                  {adminData.users.map(u => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between p-4 bg-[#ffffff0d] rounded-xl border border-[#ffffff0d] hover:border-[#ffffff33] transition-all"
                    >
                      <div>
                        <div className="font-bold text-sm">
                          {u.name} <span className="text-white/30 font-medium ml-1">@{u.username}</span>
                        </div>
                        <div className="text-[10px] text-[#ffffff66] uppercase tracking-widest font-bold">Room: {u.room_id}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteUser(u.id); }}
                        className="p-2 text-[#ffffff33] hover:text-[#ef4444] transition-colors rounded-lg hover:bg-[#ef44441a]"
                        title="Delete User"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <div className="bg-[#1A1A1A] p-6 rounded-2xl border border-[#ffffff1a] shadow-2xl">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-blue-400">
                  <Briefcase className="w-5 h-5" /> Activity Stream
                </h2>
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  {adminData.logs.slice().reverse().map(l => (
                    <div
                      key={l.id}
                      className="p-4 bg-[#ffffff0d] rounded-xl border border-[#ffffff0d] flex items-center justify-between group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-[9px] font-bold bg-[#ffffff1a] px-2 py-0.5 rounded uppercase tracking-widest">{l.date}</span>
                          <span className="text-[10px] font-bold text-emerald-400">
                            @{adminData.users.find(u => u.id === l.user_id)?.username || 'unknown'}
                          </span>
                          <span className="text-[10px] font-bold text-[#ffffff99]">ID: {l.task_id}</span>
                        </div>
                        <div className="mt-2 text-xs text-[#ffffffcc]">
                          {(() => {
                            const parsed = parseLogDetails(l.details);
                            if (!parsed) return <div className="truncate">No details provided</div>;
                            return (
                              <div className="flex flex-col gap-1 w-full">
                                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-md uppercase tracking-wider w-fit mb-1.5">{parsed.concept}</span>
                                <span className="text-xs text-white/70 line-clamp-2 leading-relaxed">{parsed.summary}</span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteLog(l.id); }}
                        className="p-2 text-[#ffffff1a] hover:text-[#ef4444] transition-colors ml-4 rounded-lg hover:bg-[#ef44441a]"
                        title="Delete Log"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isJoining) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full bg-[#1A1A1A] p-8 rounded-2xl shadow-xl border border-white/5">
          <div className="flex items-center gap-3 mb-8">
            <AppLogo size="lg" />
            <h1 className="text-2xl font-bold tracking-tight text-white">Learning Tracker</h1>
          </div>

          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Full Name</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full px-4 py-3 bg-[#2A2A2A] border-none rounded-xl focus:ring-2 focus:ring-white outline-none transition-all text-white"
                placeholder="e.g. Alex Chen"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Unique Handle (@username)</label>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                className="w-full px-4 py-3 bg-[#2A2A2A] border-none rounded-xl focus:ring-2 focus:ring-white outline-none transition-all text-white"
                placeholder="vchen99"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Room ID (for collaboration)</label>
              <input
                type="text"
                value={inputRoomId}
                onChange={(e) => setInputRoomId(e.target.value)}
                className="w-full px-4 py-3 bg-[#2A2A2A] border-none rounded-xl focus:ring-2 focus:ring-white outline-none transition-all text-white"
                placeholder="default"
              />
            </div>

            {joinError && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-xs font-bold text-center"
              >
                {joinError}
              </motion.div>
            )}
            <motion.button
              whileHover={{ scale: isLoggingIn ? 1 : 1.05 }}
              whileTap={{ scale: isLoggingIn ? 1 : 0.95 }}
              type="submit"
              disabled={isLoggingIn}
              className={`w-full py-4 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${isLoggingIn ? "bg-white/50 text-black/50 cursor-not-allowed" : "bg-white text-black hover:bg-white/90"
                }`}
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Preparing...
                </>
              ) : (
                <>
                  Start Preparation <ChevronRight className="w-4 h-4" />
                </>
              )}
            </motion.button>
          </form>

          <div className="mt-8 pt-6 border-t border-white/5">
            <motion.button
              whileHover={{ color: '#ffffff', scale: 1.02 }}
              onClick={() => setIsAdminMode(true)}
              className="w-full text-xs text-white/30 hover:text-white/60 transition-colors uppercase tracking-widest font-bold"
            >
              Admin Access
            </motion.button>
          </div>
        </div>

        {/* Admin Login Modal */}
        <AnimatePresence>
          {isAdminMode && (!adminToken || !adminData) && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-[#1A1A1A] w-full max-w-sm p-8 rounded-2xl border border-white/10"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold">Admin Login</h2>
                  <button onClick={() => { setIsAdminMode(false); setAdminToken(null); }}><X className="w-5 h-5" /></button>
                </div>

                {adminToken && !adminData ? (
                  <div className="flex flex-col items-center py-8 gap-4">
                    <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                    <p className="text-sm text-white/60 font-medium">Loading Dashboard Data...</p>
                  </div>
                ) : (
                  <form onSubmit={handleAdminLogin} className="space-y-4">
                    <input
                      type="text"
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      className="w-full px-4 py-3 bg-[#2A2A2A] border-none rounded-xl outline-none text-white"
                      placeholder="Admin Username"
                      autoFocus
                    />
                    <input
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="w-full px-4 py-3 bg-[#2A2A2A] border-none rounded-xl outline-none text-white"
                      placeholder="Admin Password"
                    />
                    <motion.button
                      whileHover={{ scale: isAdminLoggingIn ? 1 : 1.02 }}
                      whileTap={{ scale: isAdminLoggingIn ? 1 : 0.98 }}
                      type="submit"
                      disabled={isAdminLoggingIn}
                      className={`w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${isAdminLoggingIn ? "bg-white/50 text-black/50 cursor-not-allowed" : "bg-white text-black hover:bg-white/90"
                        }`}
                    >
                      {isAdminLoggingIn ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Logging in...
                        </>
                      ) : (
                        "Login"
                      )}
                    </motion.button>
                  </form>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans transition-colors duration-300">
      {/* Header */}
      <header className="bg-[#1A1A1A] border-b border-white/10 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <AppLogo size="sm" />
            <span className="font-bold text-base sm:text-lg tracking-tight">Learning Tracker</span>
          </div>

          <nav className="hidden md:flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm font-medium text-white/60 hover:text-white cursor-pointer">
              <Users className="w-4 h-4" />
              Room: {roomId}
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
              <Flame className="w-4 h-4" />
              {getStreak(user?.id || '')} Day Streak
              {(() => {
                const todayStr = new Date().toISOString().split('T')[0];
                const hasBonusToday = user && state.tasks.filter(t => t.user_id === user.id).some(t => {
                  const log = state.logs.find(l => l.user_id === user.id && l.task_id === t.id && l.date === todayStr);
                  return log && log.value >= t.target_daily * 5;
                });
                return hasBonusToday && (
                  <motion.span
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-yellow-400 text-black text-[10px] px-1.5 py-0.5 rounded font-black italic uppercase ml-1 animate-pulse"
                  >
                    +Bonus
                  </motion.span>
                );
              })()}
            </div>
            {(() => {
              const xp = user ? calculateXP(state.logs, user.id) : 0;
              const level = calculateLevel(xp);
              const xpForCurrentLevel = (level - 1) * 100;
              const progressToNextLevel = ((xp - xpForCurrentLevel) / 100) * 100;
              const badges = user ? calculateBadges(state.logs, user.id, getStreak(user.id), state.tasks) : [];
              return (
                <div className="flex items-center gap-4 ml-6 pl-6 border-l border-white/10">
                  <div className="flex items-center gap-2">
                    <div className="font-bold text-sm text-emerald-400">LVL {level}</div>
                    <div className="w-24 h-2 bg-[#2A2A2A] rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400 transition-all duration-500" style={{ width: `${progressToNextLevel}%` }} />
                    </div>
                    <div className="text-[10px] text-white/40 font-bold ml-1">{xp} XP</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {badges.map(b => (
                      <div key={b.id} title={`${b.name}: ${b.description}`} className="p-1 px-1.5 bg-white/5 rounded-md text-[13px] cursor-help hover:bg-white/10 transition-colors">
                        {b.icon}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </nav>

          {/* Mobile Info */}
          <div className="flex md:hidden items-center gap-3">
            <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full">
              <Flame className="w-3 h-3" />
              {getStreak(user?.id || '')}
              {(() => {
                const todayStr = new Date().toISOString().split('T')[0];
                const hasBonusToday = user && state.tasks.filter(t => t.user_id === user.id).some(t => {
                  const log = state.logs.find(l => l.user_id === user.id && l.task_id === t.id && l.date === todayStr);
                  return log && log.value >= t.target_daily * 5;
                });
                return hasBonusToday && <Zap className="w-2 h-2 fill-yellow-400 text-yellow-400 ml-0.5" />;
              })()}
            </div>
            <div className="text-[10px] font-bold text-white/40 bg-white/5 px-2 py-1 rounded-full">
              {roomId}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-bold">{user?.name}</div>
            <div className="text-[10px] text-white/40 font-bold tracking-tight">@{user?.username}</div>
          </div>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={handleLogout}
            className="p-2 hover:bg-white/5 rounded-full transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </motion.button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex gap-4 border-b border-white/10 pb-4">
          <button onClick={() => setActiveTab('dashboard')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors ${activeTab === 'dashboard' ? 'bg-emerald-500/20 text-emerald-400' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>Dashboard</button>
          <button onClick={() => setActiveTab('analytics')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors ${activeTab === 'analytics' ? 'bg-emerald-500/20 text-emerald-400' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>Analytics</button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Tasks & Progress */}
            <div className="lg:col-span-8 space-y-6">
              {/* Canvas Visualization */}
              <div className="bg-[#1A1A1A] rounded-2xl border border-white/10 p-6 shadow-sm overflow-hidden" ref={containerRef}>
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                  <h2 className="font-serif italic text-xl">Consistency Matrix</h2>
                  <div className="flex flex-wrap items-center gap-4 text-[10px] uppercase tracking-widest font-bold text-white/40">
                    <span>Less</span>
                    <div className="flex items-center gap-1">
                      <div className="w-2.5 h-2.5 bg-[#2A2A2A] rounded-sm"></div>
                      <div className="w-2.5 h-2.5 bg-[#064e3b] rounded-sm"></div>
                      <div className="w-2.5 h-2.5 bg-[#059669] rounded-sm"></div>
                      <div className="w-2.5 h-2.5 bg-[#10b981] rounded-sm"></div>
                      <div className="w-2.5 h-2.5 bg-[#34d399] rounded-sm"></div>
                    </div>
                    <span>More</span>
                  </div>
                </div>

                <div ref={heatmapScrollRef} className="overflow-x-auto pb-4 custom-scrollbar no-scrollbar flex gap-1.5 md:gap-2 scroll-smooth">
                  {/* Day Labels Column */}
                  <div className="flex flex-col gap-1.5 md:gap-2 pr-2 text-[9px] md:text-[10px] text-white/30 font-bold justify-between py-[18px]">
                    <span className="opacity-0 w-6 leading-none">Sun</span>
                    <span className="w-6 leading-none">Mon</span>
                    <span className="opacity-0 w-6 leading-none">Tue</span>
                    <span className="w-6 leading-none">Wed</span>
                    <span className="opacity-0 w-6 leading-none">Thu</span>
                    <span className="w-6 leading-none">Fri</span>
                    <span className="opacity-0 w-6 leading-none">Sat</span>
                  </div>

                  <div className="flex gap-1.5 md:gap-2 pt-4">
                    {/* Group days into weeks */}
                    {Array.from({ length: Math.ceil(lastDays.length / 7) }).map((_, colIdx) => {
                      const weekDays = lastDays.slice(colIdx * 7, colIdx * 7 + 7);

                      // Check if a new month starts in this week (day <= 7) to render a top label
                      const firstDay = weekDays[0];
                      let monthLabel = null;
                      if (firstDay) {
                        const d = new Date(firstDay);
                        if (d.getDate() <= 7) {
                          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                          monthLabel = monthNames[d.getMonth()];
                        }
                      }

                      return (
                        <div key={colIdx} className="relative flex flex-col gap-1.5 md:gap-2">
                          {monthLabel && (
                            <span className="absolute -top-5 left-0 text-[10px] text-white/40 font-bold whitespace-nowrap">
                              {monthLabel}
                            </span>
                          )}
                          {weekDays.map(date => {
                            const data = activityMap[date] || { intensity: 0, completedCount: 0, totalMandatory: 0, hasBonus: false };
                            const colors = ['bg-[#2A2A2A]', 'bg-[#064e3b]', 'bg-[#059669]', 'bg-[#10b981]', 'bg-[#34d399]'];
                            const bgClass = data.hasBonus ? 'bg-[#fbbf24]' : colors[data.intensity];
                            return (
                              <button
                                key={date}
                                onClick={() => setSelectedDate(date)}
                                title={data.totalMandatory > 0 ? `${data.completedCount} / ${data.totalMandatory} tasks on ${date}${data.hasBonus ? ' (Bonus!)' : ''}` : (data.intensity > 0 ? `Activity on ${date}` : `No activity on ${date}`)}
                                className={`w-3 h-3 md:w-[14px] md:h-[14px] rounded-[2px] transition-all duration-200 hover:scale-125 hover:ring-1 hover:ring-white/50 border ${date === selectedDate ? 'border-white' : 'border-black/10'} ${bgClass}`}
                                aria-label={`Activity on ${date}`}
                              />
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Date Selector & Checklist */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <h2 className="text-xl font-bold flex items-center gap-3">
                    <ChevronRight className="w-5 h-5 text-emerald-400" />
                    <span className="truncate">Tasks for {selectedDate === today ? "Today" : selectedDate}</span>
                  </h2>
                  <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 custom-scrollbar no-scrollbar">
                    {lastDays.slice(-7).map(date => (
                      <button
                        key={date}
                        onClick={() => setSelectedDate(date)}
                        className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${selectedDate === date ? "bg-white text-black" : "bg-white/5 text-white/40 hover:bg-white/10"
                          }`}
                      >
                        {date === today ? "Today" : date.split('-').slice(1).join('/')}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {userTasks.map(task => {
                    const log = state.logs.find(l => l.user_id === user?.id && l.task_id === task.id && l.date === selectedDate);
                    const value = log ? log.value : 0;
                    const progress = Math.min(100, (value / task.target_daily) * 100);
                    const isUltraBonus = value >= task.target_daily * 5;

                    return (
                      <div
                        key={task.id}
                        className={`bg-[#1A1A1A] p-6 rounded-2xl border border-white/5 relative overflow-hidden group transition-all hover:border-white/20 ${isUltraBonus ? "ring-2 ring-yellow-500/50 border-yellow-500/50 shadow-[0_0_20px_rgba(245,158,11,0.2)]" : ""
                          }`}
                      >
                        {isUltraBonus && (
                          <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="absolute -top-1 -right-1 bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 px-3 py-1 rounded-bl-xl z-10 flex items-center gap-1 shadow-lg"
                          >
                            <Zap className="w-3 h-3 text-white fill-white" />
                            <span className="text-[9px] font-black italic tracking-tighter text-white uppercase">5X Ultra Bonus</span>
                          </motion.div>
                        )}
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex gap-2">
                            <div className="p-3 bg-[#2A2A2A] rounded-xl group-hover:bg-white group-hover:text-black transition-all">
                              {task.type === 'sql' && <Database className="w-5 h-5" />}
                              {task.type === 'pyspark' && <Terminal className="w-5 h-5" />}
                              {task.type === 'project' && <Briefcase className="w-5 h-5" />}
                              {task.type === 'custom' && <Settings2 className="w-5 h-5" />}
                            </div>
                            <button
                              onClick={() => deleteTask(task.id)}
                              className="p-3 bg-[#2A2A2A] rounded-xl text-red-400 hover:bg-red-400 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                              title="Delete Task"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                          <div className="text-right">
                            <span className="text-2xl font-bold font-mono">{value}</span>
                            <span className="text-white/30 text-xs font-bold"> / {task.target_daily}</span>
                          </div>
                        </div>

                        <h3 className="font-bold mb-1">{task.title}</h3>
                        <p className="text-xs text-white/40 font-medium uppercase tracking-wider mb-4">Daily Target</p>

                        <div className="flex items-center gap-2">
                          <motion.button
                            whileHover={{ scale: 1.05, backgroundColor: 'rgba(255,255,255,0.1)' }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => updateLog(task.id, selectedDate, Math.max(0, value - 1))}
                            className="flex-1 py-2 bg-[#2A2A2A] rounded-lg text-sm font-bold transition-colors"
                          >
                            -
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.02, backgroundColor: '#f3f4f6', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                              const existingLog = state.logs.find(l => l.user_id === user?.id && l.task_id === task.id && l.date === selectedDate);
                              setActiveLogTask({ task, date: selectedDate });
                              const parsed = parseLogDetails(existingLog?.details);
                              setLogConcept(parsed?.concept || (existingLog?.details ? 'Legacy Log' : ''));
                              setLogSummary(parsed?.summary || existingLog?.details || '');
                              setLogValue(existingLog ? existingLog.value : 1);
                            }}
                            className="flex-[2] py-2 bg-white text-black rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2"
                          >
                            <Plus className="w-4 h-4" /> {log ? 'Update Progress' : 'Log Progress'}
                          </motion.button>
                        </div>

                        <div className="mt-4 h-1 w-full bg-[#2A2A2A] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all duration-500"
                            style={{ width: `${progress}%` }}
                          />
                        </div>

                        {log?.details && (
                          <div className="mt-4 p-3 bg-[#2A2A2A] rounded-lg text-[10px] text-white/60 font-medium flex items-start justify-between gap-2 group/details">
                            <div className="flex items-start gap-2 w-full">
                              <Info className="w-3 h-3 mt-0.5 shrink-0" />
                              {(() => {
                                const parsed = parseLogDetails(log.details);
                                if (!parsed) return <div className="break-all">{log.details}</div>;
                                return (
                                  <div className="flex flex-col gap-1 flex-1">
                                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-md uppercase tracking-wider w-fit mb-1.5">{parsed.concept}</span>
                                    <span className="text-xs text-white/70 line-clamp-2 leading-relaxed">{parsed.summary}</span>
                                  </div>
                                );
                              })()}
                            </div>
                            <button
                              onClick={() => {
                                setActiveLogTask({ task, date: selectedDate });
                                const parsed = parseLogDetails(log.details);
                                setLogConcept(parsed?.concept || (log.details ? 'Legacy Log' : ''));
                                setLogSummary(parsed?.summary || log.details || '');
                                setLogValue(log.value);
                              }}
                              className="opacity-0 group-hover/details:opacity-100 p-1 hover:bg-white/10 rounded transition-all shrink-0"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <button
                    onClick={() => setIsAddTaskModalOpen(true)}
                    className="border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center p-6 text-white/30 hover:text-white hover:border-white/30 transition-all gap-2 group"
                  >
                    <motion.div
                      whileHover={{ scale: 1.2, rotate: 90 }}
                      transition={{ type: "spring", stiffness: 300 }}
                    >
                      <Plus className="w-8 h-8" />
                    </motion.div>
                    <span className="font-bold text-sm uppercase tracking-widest">Add Custom Goal</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: Collaboration & Friends */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-black dark:bg-[#1A1A1A] text-white rounded-2xl p-6 shadow-xl border border-white/5">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-serif italic text-xl">Collaborators</h2>
                  <Share2 className="w-4 h-4 opacity-50 cursor-pointer" />
                </div>

                <div className="space-y-4">
                  {state.users.map(u => (
                    <div key={u.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-blue-500 flex items-center justify-center text-[10px] font-bold">
                          {u.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-bold">{u.name} {u.id === user?.id && "(You)"}</div>
                          <div className="text-[10px] text-white/40 uppercase tracking-widest font-bold">
                            {getStreak(u.id)} Day Streak
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {(() => {
                          const userLogsToday = state.logs.filter(l => l.user_id === u.id && l.date === selectedDate);
                          const userTasksCount = state.tasks.filter(t => t.user_id === u.id);
                          const hasBonusToday = userTasksCount.some(t => {
                            const log = userLogsToday.find(l => l.task_id === t.id);
                            return log && log.value >= t.target_daily * 5;
                          });

                          return (
                            <>
                              {getStreak(u.id) > 0 && (
                                <div className="flex items-center">
                                  <Flame className={`w-4 h-4 ${hasBonusToday ? "text-yellow-400 animate-pulse" : "text-orange-500"}`} />
                                  {hasBonusToday && <span className="text-[10px] font-bold text-yellow-400 ml-0.5">+2</span>}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 p-4 bg-white/5 rounded-xl border border-white/5">
                  <p className="text-xs text-white/60 leading-relaxed italic">
                    "Consistency is what transforms average into excellence. Keep pushing each other."
                  </p>
                </div>
              </div>

              <div className="bg-white dark:bg-[#1A1A1A] rounded-2xl border border-black/10 dark:border-white/10 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-bold flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-yellow-500" />
                    Global Leaderboard
                  </h2>
                  <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Top 5</div>
                </div>

                <div className="space-y-4">
                  {leaderboard.length > 0 ? (
                    leaderboard.map((entry, i) => {
                      const league = getLeagueInfo(i);
                      return (
                        <div key={`${entry.name}-${i}`} className="flex items-center justify-between group">
                          <div className="flex items-center gap-3">
                            <div className="text-2xl">{league.name.split(' ')[0]}</div>
                            <div>
                              <div className="text-sm font-bold">{entry.name}</div>
                              <div className="text-[10px] text-white/40 uppercase tracking-widest font-bold mt-0.5">
                                Room: {entry.roomId} • XP: {(entry.totalVolume || 0) * 10}
                              </div>
                              <div className={`text-[10px] font-bold mt-1 ${league.color}`}>{league.name.split(' ').slice(1).join(' ')}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 bg-emerald-500/10 px-2 py-1 rounded-lg">
                            <Flame className="w-3 h-3 text-emerald-500" />
                            <span className="text-sm font-bold text-emerald-500">{entry.streak}</span>
                          </div>
                        </div>
                      )
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#1A1A1A] p-6 rounded-2xl border border-white/10 h-[400px] flex flex-col">
              <h2 className="text-lg font-bold mb-6 flex items-center gap-2">Productivity by Day</h2>
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={aggregatedData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" vertical={false} />
                    <XAxis dataKey="name" stroke="#ffffff66" tick={{ fill: '#ffffff66', fontSize: 12 }} />
                    <YAxis stroke="#ffffff66" tick={{ fill: '#ffffff66', fontSize: 12 }} />
                    <RechartsTooltip cursor={{ fill: '#ffffff0a' }} contentStyle={{ backgroundColor: '#2A2A2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                    <Bar dataKey="volume" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-[#1A1A1A] p-6 rounded-2xl border border-white/10 h-[400px] flex flex-col">
              <h2 className="text-lg font-bold mb-6 flex items-center gap-2">Focus Distribution</h2>
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                      {pieData.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={COLORS[entry.name] || '#10b981'} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={{ backgroundColor: '#2A2A2A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                    <Legend wrapperStyle={{ fontSize: '12px', marginTop: '10px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Add Task Modal */}
      <AnimatePresence>
        {isAddTaskModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-[#1A1A1A] w-full max-w-md rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h3 className="font-bold text-lg">Add Custom Goal</h3>
                <button onClick={() => setIsAddTaskModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">Goal Title</label>
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    className="w-full px-4 py-3 bg-[#2A2A2A] border-none rounded-xl outline-none text-white"
                    placeholder="e.g. Read 10 pages of Spark documentation"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">Daily Target (Number)</label>
                  <input
                    type="number"
                    value={newTaskTarget}
                    onChange={(e) => setNewTaskTarget(e.target.value)}
                    className="w-full px-4 py-3 bg-[#2A2A2A] border-none rounded-xl outline-none text-white"
                  />
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleAddTaskSubmit}
                  className="w-full py-3 bg-white text-black rounded-xl font-bold hover:bg-white/90 transition-all"
                >
                  Add Goal
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Log Details Modal */}
      <AnimatePresence>
        {activeLogTask && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white dark:bg-[#1A1A1A] w-full max-w-md rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 overflow-hidden"
            >
              <div className="p-6 border-b border-black/5 dark:border-white/5 flex items-center justify-between">
                <h3 className="font-bold text-lg">Log Progress</h3>
                <button onClick={() => setActiveLogTask(null)} className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 mb-2">Task</label>
                  <div className="font-bold">{activeLogTask.task.title}</div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 mb-2">Total Progress</label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setLogValue(prev => Math.max(0, prev - 1))}
                        className="p-2 bg-[#F5F5F0] dark:bg-[#2A2A2A] rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        value={logValue}
                        onChange={(e) => setLogValue(parseInt(e.target.value) || 0)}
                        className="w-full px-4 py-2 bg-[#F5F5F0] dark:bg-[#2A2A2A] border-none rounded-xl focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all dark:text-white text-center font-bold"
                      />
                      <button
                        onClick={() => setLogValue(prev => prev + 1)}
                        className="p-2 bg-[#F5F5F0] dark:bg-[#2A2A2A] rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 mb-2">Core Concept (What did you focus on?)</label>
                    <input
                      type="text"
                      autoFocus
                      maxLength={50}
                      value={logConcept}
                      onChange={(e) => setLogConcept(e.target.value)}
                      className="w-full px-4 py-3 bg-[#F5F5F0] dark:bg-[#2A2A2A] border-none rounded-xl focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all dark:text-white"
                      placeholder="Topic related to the task"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 mb-2">Key Takeaway or Biggest Blocker</label>
                    <textarea
                      value={logSummary}
                      onChange={(e) => setLogSummary(e.target.value)}
                      className="w-full px-4 py-3 bg-[#F5F5F0] dark:bg-[#2A2A2A] border-none rounded-xl focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all dark:text-white min-h-[80px] resize-none"
                      placeholder="Explain it simply: What was the hardest part? What did you learn?"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => setActiveLogTask(null)}
                    className="flex-1 py-3 bg-[#F5F5F0] dark:bg-[#2A2A2A] rounded-xl font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleLogSubmit}
                    disabled={!logConcept.trim() || !logSummary.trim()}
                    className="flex-[2] py-3 bg-black dark:bg-white text-white dark:text-black rounded-xl font-bold hover:bg-black/90 dark:hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Confirm & Log
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
