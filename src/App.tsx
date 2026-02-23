/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Stage, Layer, Rect, Text, Group, Line } from 'react-konva';
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

  // Selected Date for logging/viewing
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  // Modals State
  const [activeLogTask, setActiveLogTask] = useState<{ task: Task; date: string } | null>(null);
  const [logDetails, setLogDetails] = useState('');
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
  const [leaderboard, setLeaderboard] = useState<{ name: string, roomId: string, streak: number }[]>([]);

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
      updateLog(activeLogTask.task.id, activeLogTask.date, logValue, logDetails);
      setActiveLogTask(null);
      setLogDetails('');
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
                        <div className="text-xs text-[#ffffffcc] truncate">{l.details || "No details provided"}</div>
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

      <main className="max-w-7xl mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
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

            <div className="overflow-x-auto pb-4 custom-scrollbar no-scrollbar">
              <Stage
                width={Math.max(canvasSize.width - 48, (lastDays.length / 7) * (window.innerWidth < 768 ? 22 : 14) + 60)}
                height={window.innerWidth < 768 ? 200 : 150}
              >
                <Layer>
                  {/* Day Labels */}
                  {['Mon', 'Wed', 'Fri'].map((day, i) => (
                    <Text
                      key={day}
                      text={day}
                      x={window.innerWidth < 768 ? 5 : 0}
                      y={window.innerWidth < 768 ? 42 + (i * 2 + 1) * 22 : 28 + (i * 2 + 1) * 14}
                      fontSize={window.innerWidth < 768 ? 10 : 9}
                      fontFamily="Inter"
                      fill="#FFFFFF"
                      opacity={0.3}
                    />
                  ))}

                  {/* Heatmap Grid */}
                  {lastDays.map((date, dayIdx) => {
                    const col = Math.floor(dayIdx / 7);
                    const row = dayIdx % 7;
                    const isMobile = window.innerWidth < 768;
                    const squareSize = isMobile ? 18 : 11;
                    const pitch = isMobile ? 22 : 14;
                    const startX = isMobile ? 40 : 30;
                    const startY = isMobile ? 35 : 25;

                    const x = startX + col * pitch;
                    const y = startY + row * pitch;

                    const userTasksForHeatmap = state.tasks.filter(t => t.user_id === user?.id);
                    const dayLogs = state.logs.filter(l => l.user_id === user?.id && l.date === date);

                    let intensity = 0; // 0 to 4
                    if (userTasksForHeatmap.length > 0) {
                      const completedCount = userTasksForHeatmap.filter(t => {
                        const log = dayLogs.find(l => l.task_id === t.id);
                        return (log?.value || 0) >= t.target_daily;
                      }).length;

                      const ratio = completedCount / userTasksForHeatmap.length;
                      if (completedCount === 0 && dayLogs.some(l => l.value > 0)) intensity = 1;
                      else if (ratio > 0 && ratio < 0.5) intensity = 2;
                      else if (ratio >= 0.5 && ratio < 1) intensity = 3;
                      else if (ratio === 1) intensity = 4;
                    }

                    const hasBonus = userTasksForHeatmap.some(t => {
                      const log = dayLogs.find(l => l.task_id === t.id);
                      return log && log.value >= t.target_daily * 5;
                    });

                    const colors = ['#2A2A2A', '#064e3b', '#059669', '#10b981', '#34d399'];
                    const fill = hasBonus ? '#fbbf24' : colors[intensity]; // Use amber/gold for bonus

                    // Month Labels
                    const d = new Date(date);
                    if (row === 0 && d.getDate() <= 7) {
                      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      return (
                        <Group key={date}>
                          <Text
                            text={monthNames[d.getMonth()]}
                            x={x}
                            y={isMobile ? 10 : 5}
                            fontSize={isMobile ? 11 : 9}
                            fontFamily="Inter"
                            fill="#FFFFFF"
                            opacity={0.4}
                            fontStyle="bold"
                          />
                          <Rect
                            x={x}
                            y={y}
                            width={squareSize}
                            height={squareSize}
                            fill={fill}
                            cornerRadius={2}
                            stroke={date === selectedDate ? '#FFFFFF' : 'transparent'}
                            strokeWidth={1}
                            onClick={() => setSelectedDate(date)}
                          />
                        </Group>
                      );
                    }

                    return (
                      <Rect
                        key={date}
                        x={x}
                        y={y}
                        width={squareSize}
                        height={squareSize}
                        fill={fill}
                        cornerRadius={2}
                        stroke={date === selectedDate ? '#FFFFFF' : 'transparent'}
                        strokeWidth={1}
                        onClick={() => setSelectedDate(date)}
                      />
                    );
                  })}
                </Layer>
              </Stage>
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
                          setLogDetails(existingLog?.details || '');
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
                        <div className="flex items-start gap-2">
                          <Info className="w-3 h-3 mt-0.5 shrink-0" />
                          <div className="break-all">{log.details}</div>
                        </div>
                        <button
                          onClick={() => {
                            setActiveLogTask({ task, date: selectedDate });
                            setLogDetails(log.details || '');
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
                leaderboard.map((entry, i) => (
                  <div key={`${entry.name}-${i}`} className="flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold",
                        i === 0 ? "bg-yellow-500 text-black" :
                          i === 1 ? "bg-slate-300 text-black" :
                            i === 2 ? "bg-amber-600 text-white" : "bg-white/10 text-white/60"
                      )}>
                        {i + 1}
                      </div>
                      <div>
                        <div className="text-sm font-bold">{entry.name}</div>
                        <div className="text-[10px] text-white/40 uppercase tracking-widest font-bold">
                          Room: {entry.roomId}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 bg-emerald-500/10 px-2 py-1 rounded-lg">
                      <Flame className="w-3 h-3 text-emerald-500" />
                      <span className="text-sm font-bold text-emerald-500">{entry.streak}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-white/20">
                  <Medal className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-xs font-bold uppercase tracking-widest">No streaks yet</p>
                </div>
              )}
            </div>
          </div>
        </div>
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

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 mb-2">Details (Question, Link, or Topic)</label>
                  <textarea
                    autoFocus
                    value={logDetails}
                    onChange={(e) => setLogDetails(e.target.value)}
                    className="w-full px-4 py-3 bg-[#F5F5F0] dark:bg-[#2A2A2A] border-none rounded-xl focus:ring-2 focus:ring-black dark:focus:ring-white outline-none transition-all dark:text-white min-h-[100px] resize-none"
                    placeholder="e.g. LeetCode 185. Department Top Three Salaries"
                  />
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
                    disabled={!logDetails.trim()}
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
