import { Log, Task, StreakFreeze } from "../types";

export const calculateXP = (logs: Log[], userId: string) => {
  const userLogs = logs.filter((l) => l.user_id === userId);
  const totalVolume = userLogs.reduce((sum, log) => sum + (log.value || 0), 0);
  return totalVolume * 10;
};

export const calculateLevel = (xp: number) => {
  return Math.floor(xp / 100) + 1;
};

export const calculateBadges = (logs: Log[], userId: string, streak: number, tasks: Task[]) => {
  const badges: { id: string; icon: string; name: string; description: string }[] = [];
  const userLogs = logs.filter((l) => l.user_id === userId);

  if (streak >= 7) badges.push({ id: "streak_7", icon: "🔥", name: "7-Day Streak", description: "Streak ≥ 7" });
  if (streak >= 30) badges.push({ id: "streak_30", icon: "⚡", name: "30-Day Warrior", description: "Streak ≥ 30" });

  if (userLogs.length >= 100) badges.push({ id: "centurion", icon: "💯", name: "Centurion", description: "100+ log entries" });

  const sqlTasks = tasks.filter((t) => t.user_id === userId && t.type === "sql").map((t) => t.id);
  const sqlVolume = userLogs
    .filter((l) => sqlTasks.includes(l.task_id))
    .reduce((sum, log) => sum + (log.value || 0), 0);
  if (sqlVolume >= 50) badges.push({ id: "sql_master", icon: "🗄️", name: "SQL Master", description: "50+ SQL questions" });
  if (sqlVolume >= 200) badges.push({ id: "sql_god", icon: "🏆", name: "SQL God", description: "200+ SQL questions" });

  const sparkTasks = tasks.filter((t) => t.user_id === userId && t.type === "pyspark").map((t) => t.id);
  const sparkVolume = userLogs
    .filter((l) => sparkTasks.includes(l.task_id))
    .reduce((sum, log) => sum + (log.value || 0), 0);
  if (sparkVolume >= 20) badges.push({ id: "spark_master", icon: "⚡", name: "Spark Master", description: "20+ PySpark sessions" });

  return badges;
};

export const getLeagueInfo = (rank: number) => {
  if (rank === 0) return { name: "🥇 Gold League", color: "text-yellow-400" };
  if (rank === 1 || rank === 2) return { name: "🥈 Silver League", color: "text-slate-300" };
  if (rank === 3 || rank === 4) return { name: "🥉 Bronze League", color: "text-amber-600" };
  return { name: "Iron League", color: "text-white/40" };
};

/**
 * Calculates streak for a user.
 * Streak freezes allow a single missed day to not break the streak (1 per week).
 */
export function getStreak(
  userId: string,
  tasks: Task[],
  logs: Log[],
  streakFreezes: StreakFreeze[] = []
): number {
  const userTasks = tasks.filter((t) => t.user_id === userId);
  const userLogs = logs.filter((l) => l.user_id === userId);
  const frozenDates = new Set(streakFreezes.filter((f) => f.user_id === userId).map((f) => f.used_on));

  const datesWithLogs = [...new Set(userLogs.map((l) => l.date))].sort().reverse() as string[];
  const completedDates: { date: string; points: number }[] = [];

  for (const date of datesWithLogs) {
    const dayTasks = userTasks.map((task) => {
      const log = userLogs.find((l) => l.task_id === task.id && l.date === date);
      return { target: task.target_daily, value: log?.value || 0 };
    });

    const isAnyTaskComplete = dayTasks.some((t) => t.value >= t.target);
    if (isAnyTaskComplete) {
      const isBonusEarned = dayTasks.some((t) => t.value >= t.target * 5);
      completedDates.push({ date, points: isBonusEarned ? 2 : 1 });
    }
  }

  let streak = 0;
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0));
  let current = today;
  let usedFreezeInChain = false;

  for (let i = 0; i < completedDates.length; i++) {
    const [y, m, d] = completedDates[i].date.split("-").map(Number);
    const logDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const diff = Math.floor((current.getTime() - logDate.getTime()) / (1000 * 3600 * 24));

    if (diff === 0 || diff === 1) {
      streak += completedDates[i].points;
      current = logDate;
      usedFreezeInChain = false;
    } else if (diff === 2 && !usedFreezeInChain) {
      // Gap of 2 days — check if the skipped day has a freeze applied
      const skippedDate = new Date(current.getTime() - 86400000).toISOString().split("T")[0];
      if (frozenDates.has(skippedDate)) {
        streak += completedDates[i].points;
        current = logDate;
        usedFreezeInChain = true;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Checks if a streak freeze can be used this week (max 1 per 7 days)
 */
export function canUseStreakFreeze(userId: string, streakFreezes: StreakFreeze[]): boolean {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekStr = weekAgo.toISOString().split("T")[0];
  const recent = streakFreezes.filter((f) => f.user_id === userId && f.used_on >= weekStr);
  return recent.length === 0;
}