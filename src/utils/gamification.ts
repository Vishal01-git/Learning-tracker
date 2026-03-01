import { Log, Task } from '../types';

export const calculateXP = (logs: Log[], userId: string) => {
    const userLogs = logs.filter(l => l.user_id === userId);
    const totalVolume = userLogs.reduce((sum, log) => sum + (log.value || 0), 0);
    return totalVolume * 10; // 1 logged value = 10 XP
};

export const calculateLevel = (xp: number) => {
    return Math.floor(xp / 100) + 1;
};

export const calculateBadges = (logs: Log[], userId: string, streak: number, tasks: Task[]) => {
    const badges: { id: string, icon: string, name: string, description: string }[] = [];
    const userLogs = logs.filter(l => l.user_id === userId);

    if (streak >= 7) {
        badges.push({ id: 'streak_7', icon: '🔥', name: '7-Day Streak', description: 'Streak is >= 7' });
    }

    if (userLogs.length >= 100) {
        badges.push({ id: 'centurion', icon: '💯', name: 'Centurion', description: 'Total number of logs >= 100' });
    }

    // Calculate SQL volume
    const sqlTasks = tasks.filter(t => t.user_id === userId && t.type === 'sql').map(t => t.id);
    const sqlVolume = userLogs
        .filter(l => sqlTasks.includes(l.task_id))
        .reduce((sum, log) => sum + (log.value || 0), 0);

    if (sqlVolume >= 50) {
        badges.push({ id: 'sql_master', icon: '🗄️', name: 'SQL Master', description: 'Total logged value for sql >= 50' });
    }

    return badges;
};

export const getLeagueInfo = (rank: number) => {
    if (rank === 0) return { name: '🥇 Gold League', color: 'text-yellow-400' };
    if (rank === 1 || rank === 2) return { name: '🥈 Silver League', color: 'text-slate-300' };
    if (rank === 3 || rank === 4) return { name: '🥉 Bronze League', color: 'text-amber-600' };
    return { name: 'Iron League', color: 'text-white/40' };
};
