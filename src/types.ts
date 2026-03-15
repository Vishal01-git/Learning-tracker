import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface User {
  id: string;
  name: string;
  username?: string;
  room_id: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  type: "sql" | "pyspark" | "project" | "custom";
  target_daily: number;
  sort_order?: number;
  created_at?: string;
}

export interface Log {
  id: number;
  user_id: string;
  task_id: string;
  date: string;
  value: number;
  details?: string;
}

export interface StreakFreeze {
  id: number;
  user_id: string;
  used_on: string;
  created_at?: string;
}

export interface AppState {
  users: User[];
  tasks: Task[];
  logs: Log[];
  streakFreezes: StreakFreeze[];
}

export interface AuthSession {
  userId: string;
  token: string;
  user: User;
  roomId: string;
}