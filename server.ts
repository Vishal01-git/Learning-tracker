import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { Pool } from "pg";
import path from "path";
import "dotenv/config";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── JWT Secret ────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production!");
  }
  console.warn("⚠️  Using insecure default JWT_SECRET. Set JWT_SECRET in .env for production.");
  return "dev-secret-change-in-production-please";
})();

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || JWT_SECRET + "_admin";

// ─── DB Pool ───────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

// ─── Zod Schemas ──────────────────────────────────────────────────────────────
const InitUserSchema = z.object({
  name: z.string().min(1).max(50).trim(),
  username: z.string().min(1).max(30).trim().transform((v) => v.toLowerCase().replace(/^@/, "")),
  roomId: z.string().min(1).max(50).trim().default("default"),
});

const UpdateLogSchema = z.object({
  userId: z.string().min(1).max(50),
  taskId: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().int().min(0).max(9999),
  details: z.string().max(2000).optional().nullable(),
});

const AddTaskSchema = z.object({
  userId: z.string().min(1).max(50),
  title: z.string().min(1).max(100).trim(),
  type: z.enum(["sql", "pyspark", "project", "custom"]),
  targetDaily: z.number().int().min(1).max(100),
});

const DeleteTaskSchema = z.object({
  taskId: z.string().min(1).max(100),
});

const ReorderTasksSchema = z.object({
  userId: z.string().min(1).max(50),
  taskIds: z.array(z.string().min(1).max(100)).min(1).max(50),
});

const WsJoinSchema = z.object({
  type: z.literal("join"),
  token: z.string().min(1), // JWT token for WS auth
  roomId: z.string().min(1).max(50),
});

const AdminLoginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(200),
});

// ─── DB Init ──────────────────────────────────────────────────────────────────
const initDb = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        target_daily INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        value INTEGER DEFAULT 0,
        details TEXT
      );

      CREATE TABLE IF NOT EXISTS streak_freezes (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        used_on TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, used_on)
      );

      DROP TABLE IF EXISTS task_mandatory_settings;
    `);
    console.log("✅ Database initialized");
  } catch (err) {
    console.error("Database initialization error:", err);
  } finally {
    client.release();
  }
};

// ─── Auth Helpers ─────────────────────────────────────────────────────────────
function signUserToken(userId: string): string {
  return jwt.sign({ userId, type: "user" }, JWT_SECRET, { expiresIn: "30d" });
}

function verifyUserToken(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.type !== "user") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

function signAdminToken(): string {
  return jwt.sign({ type: "admin" }, ADMIN_JWT_SECRET, { expiresIn: "8h" });
}

function verifyAdminToken(token: string): boolean {
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET) as any;
    return payload.type === "admin";
  } catch {
    return false;
  }
}

// ─── Rate Limiters ────────────────────────────────────────────────────────────
const initUserLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: "Too many requests. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

const stateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Too many requests." },
});

const leaderboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many requests." },
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many login attempts." },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization;
  if (!token || !verifyAdminToken(token)) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
}

// ─── Main Server ──────────────────────────────────────────────────────────────
async function startServer() {
  await initDb();

  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "10kb" }));

  app.get("/api/ping", (req, res) => res.json({ pong: true }));

  // ── State ──────────────────────────────────────────────────────────────────
  app.get("/api/state/:roomId", stateLimiter, async (req, res) => {
    const roomId = req.params.roomId?.slice(0, 50);
    if (!roomId) return res.status(400).json({ error: "Invalid roomId" });

    try {
      const usersRes = await pool.query("SELECT * FROM users WHERE room_id = $1", [roomId]);
      const users = usersRes.rows;
      const userIds = users.map((u: any) => u.id);

      if (userIds.length === 0) return res.json({ users: [], tasks: [], logs: [] });

      const tasksRes = await pool.query(
        `SELECT * FROM tasks WHERE user_id = ANY($1) ORDER BY sort_order ASC, created_at ASC`,
        [userIds]
      );
      const logsRes = await pool.query(`SELECT * FROM logs WHERE user_id = ANY($1)`, [userIds]);
      const freezesRes = await pool.query(`SELECT * FROM streak_freezes WHERE user_id = ANY($1)`, [userIds]);

      res.json({
        users,
        tasks: tasksRes.rows,
        logs: logsRes.rows,
        streakFreezes: freezesRes.rows,
      });
    } catch (err) {
      console.error("State fetch error:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // ── Init User ─────────────────────────────────────────────────────────────
  app.post("/api/init-user", initUserLimiter, async (req, res) => {
    const parsed = InitUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
    }

    const { name, username, roomId } = parsed.data;
    const cleanUsername = username.replace(/[^a-z0-9_]/g, "").slice(0, 30);

    if (!cleanUsername) {
      return res.status(400).json({ error: "Username must contain only letters, numbers, or underscores." });
    }

    try {
      await pool.query(
        "INSERT INTO rooms (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
        [roomId, `Room ${roomId}`]
      );

      const userRes = await pool.query("SELECT * FROM users WHERE username = $1", [cleanUsername]);
      let user = userRes.rows[0];

      if (!user) {
        const userId = `user_${Math.random().toString(36).substr(2, 9)}`;
        await pool.query(
          "INSERT INTO users (id, name, username, room_id) VALUES ($1, $2, $3, $4)",
          [userId, name, cleanUsername, roomId]
        );

        const defaultTasks = [
          { id: `${userId}_sql`, title: "SQL Practice (2 questions)", type: "sql", target: 2, order: 0 },
          { id: `${userId}_pyspark`, title: "PySpark Learning", type: "pyspark", target: 1, order: 1 },
          { id: `${userId}_project`, title: "DE Project Work", type: "project", target: 1, order: 2 },
        ];
        for (const t of defaultTasks) {
          await pool.query(
            "INSERT INTO tasks (id, user_id, title, type, target_daily, sort_order) VALUES ($1, $2, $3, $4, $5, $6)",
            [t.id, userId, t.title, t.type, t.target, t.order]
          );
        }

        const token = signUserToken(userId);
        return res.json({ success: true, userId, token });
      } else {
        if (user.name.toLowerCase() !== name.toLowerCase()) {
          return res.status(401).json({
            error: `The handle '@${cleanUsername}' is already taken. Please choose a different username.`,
          });
        }
        if (user.room_id !== roomId) {
          await pool.query("UPDATE users SET room_id = $1 WHERE id = $2", [roomId, user.id]);
        }
        const token = signUserToken(user.id);
        return res.json({ success: true, userId: user.id, token });
      }
    } catch (err) {
      console.error("Init User Error:", err);
      res.status(500).json({ error: "Failed to initialize user" });
    }
  });

  // ── Streak Freeze ─────────────────────────────────────────────────────────
  app.post("/api/streak-freeze", stateLimiter, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const auth = verifyUserToken(token);
    if (!auth) return res.status(401).json({ error: "Invalid token" });

    const dateSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
    const parsed = dateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid date" });

    const { date } = parsed.data;
    const { userId } = auth;

    try {
      // Check weekly limit (1 per week)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekStr = weekAgo.toISOString().split("T")[0];

      const recentRes = await pool.query(
        "SELECT COUNT(*) FROM streak_freezes WHERE user_id = $1 AND used_on >= $2",
        [userId, weekStr]
      );
      if (parseInt(recentRes.rows[0].count) >= 1) {
        return res.status(400).json({ error: "You can only use 1 streak freeze per week." });
      }

      await pool.query(
        "INSERT INTO streak_freezes (user_id, used_on) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [userId, date]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("Streak freeze error:", err);
      res.status(500).json({ error: "Failed to apply streak freeze" });
    }
  });

  // ── Reorder Tasks ─────────────────────────────────────────────────────────
  app.post("/api/reorder-tasks", stateLimiter, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const auth = verifyUserToken(token);
    if (!auth) return res.status(401).json({ error: "Invalid token" });

    const parsed = ReorderTasksSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

    const { userId, taskIds } = parsed.data;
    if (auth.userId !== userId) return res.status(403).json({ error: "Forbidden" });

    try {
      for (let i = 0; i < taskIds.length; i++) {
        await pool.query(
          "UPDATE tasks SET sort_order = $1 WHERE id = $2 AND user_id = $3",
          [i, taskIds[i], userId]
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Reorder error:", err);
      res.status(500).json({ error: "Failed to reorder tasks" });
    }
  });

  // ── Profile Update ────────────────────────────────────────────────────────
  app.put("/api/profile", stateLimiter, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const auth = verifyUserToken(token);
    if (!auth) return res.status(401).json({ error: "Invalid token" });

    const ProfileSchema = z.object({
      name: z.string().min(1).max(50).trim(),
      roomId: z.string().min(1).max(50).trim(),
    });
    const parsed = ProfileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

    const { name, roomId } = parsed.data;
    try {
      await pool.query("INSERT INTO rooms (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [roomId, `Room ${roomId}`]);
      await pool.query("UPDATE users SET name = $1, room_id = $2 WHERE id = $3", [name, roomId, auth.userId]);
      const newToken = signUserToken(auth.userId);
      res.json({ success: true, token: newToken });
    } catch (err) {
      console.error("Profile update error:", err);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // ── Export Data ───────────────────────────────────────────────────────────
  app.get("/api/export", stateLimiter, async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const auth = verifyUserToken(token);
    if (!auth) return res.status(401).json({ error: "Invalid token" });

    try {
      const user = (await pool.query("SELECT * FROM users WHERE id = $1", [auth.userId])).rows[0];
      const tasks = (await pool.query("SELECT * FROM tasks WHERE user_id = $1 ORDER BY sort_order", [auth.userId])).rows;
      const logs = (await pool.query("SELECT * FROM logs WHERE user_id = $1 ORDER BY date", [auth.userId])).rows;

      res.json({ exportedAt: new Date().toISOString(), user, tasks, logs });
    } catch (err) {
      res.status(500).json({ error: "Export failed" });
    }
  });

  // ── Leaderboard ───────────────────────────────────────────────────────────
  app.get("/api/leaderboard", leaderboardLimiter, async (req, res) => {
    try {
      const allUsersRes = await pool.query("SELECT id, name, username, room_id FROM users");
      const allTasksRes = await pool.query("SELECT id, user_id, target_daily FROM tasks");
      const allLogsRes = await pool.query("SELECT user_id, task_id, date, value FROM logs");
      const allFreezesRes = await pool.query("SELECT user_id, used_on FROM streak_freezes");

      const allUsers = allUsersRes.rows;
      const allTasks = allTasksRes.rows;
      const allLogs = allLogsRes.rows;
      const allFreezes = allFreezesRes.rows;

      const leaderboard = allUsers.map((u) => {
        const userTasks = allTasks.filter((t) => t.user_id === u.id);
        const userLogs = allLogs.filter((l) => l.user_id === u.id);
        const userFreezes = allFreezes.filter((f) => f.user_id === u.id).map((f) => f.used_on);
        const totalVolume = userLogs.reduce((sum, log) => sum + (log.value || 0), 0);

        if (userTasks.length === 0) return { ...u, streak: 0, totalVolume };

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

        for (let i = 0; i < completedDates.length; i++) {
          const [y, m, d] = completedDates[i].date.split("-").map(Number);
          const logDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
          const diff = Math.floor((current.getTime() - logDate.getTime()) / (1000 * 3600 * 24));

          if (diff === 0 || diff === 1) {
            streak += completedDates[i].points;
            current = logDate;
          } else if (diff === 2 && userFreezes.includes(completedDates[i - 1]?.date)) {
            // Frozen day bridges the gap
            streak += completedDates[i].points;
            current = logDate;
          } else {
            break;
          }
        }

        return { name: u.name, username: u.username, roomId: u.room_id, streak, totalVolume };
      });

      const sorted = leaderboard
        .filter((u: any) => u.streak > 0 || u.totalVolume > 0)
        .sort((a, b) => (b.streak !== a.streak ? b.streak - a.streak : b.totalVolume - a.totalVolume))
        .slice(0, 5);

      res.json({ leaderboard: sorted });
    } catch (err) {
      console.error("Leaderboard Error:", err);
      res.status(500).json({ error: "Failed to generate leaderboard" });
    }
  });

  // ── Admin ──────────────────────────────────────────────────────────────────
  app.post("/api/admin/login", adminLoginLimiter, (req, res) => {
    const parsed = AdminLoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

    const { username, password } = parsed.data;
    const validPassword = process.env.ADMIN_PASSWORD || "admin123";
    if (username === "admin" && password === validPassword) {
      const token = signAdminToken();
      res.json({ success: true, token });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.get("/api/admin/data", requireAdmin, async (req, res) => {
    try {
      const users = (await pool.query("SELECT * FROM users")).rows;
      const tasks = (await pool.query("SELECT * FROM tasks ORDER BY sort_order")).rows;
      const logs = (await pool.query("SELECT * FROM logs ORDER BY id")).rows;
      const rooms = (await pool.query("SELECT * FROM rooms")).rows;
      res.json({ users, tasks, logs, rooms });
    } catch (err) {
      console.error("Admin data error:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.delete("/api/admin/user/:id", requireAdmin, async (req, res) => {
    const id = req.params.id?.slice(0, 50);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  app.delete("/api/admin/log/:id", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      await pool.query("DELETE FROM logs WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete log" });
    }
  });

  app.delete("/api/admin/task/:id", requireAdmin, async (req, res) => {
    const id = req.params.id?.slice(0, 100);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    try {
      await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  // ── WebSocket (with JWT auth) ──────────────────────────────────────────────
  const clients = new Map<WebSocket, { roomId: string; userId: string }>();

  wss.on("connection", (ws) => {
    let authenticated = false;
    let authTimeout: NodeJS.Timeout;

    // Kick unauthenticated connections after 10s
    authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.send(JSON.stringify({ type: "error", message: "Authentication timeout" }));
        ws.close();
      }
    }, 10000);

    ws.on("message", async (data) => {
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }

      // ── Join / Auth ──────────────────────────────────────────────────────
      if (message.type === "join") {
        const parsed = WsJoinSchema.safeParse(message);
        if (!parsed.success) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid join payload" }));
          ws.close();
          return;
        }

        const auth = verifyUserToken(parsed.data.token);
        if (!auth) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid or expired token" }));
          ws.close();
          return;
        }

        clearTimeout(authTimeout);
        authenticated = true;
        clients.set(ws, { roomId: parsed.data.roomId, userId: auth.userId });
        ws.send(JSON.stringify({ type: "joined", userId: auth.userId }));
        return;
      }

      if (!authenticated) {
        ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
        return;
      }

      const clientInfo = clients.get(ws);
      if (!clientInfo) return;

      function broadcast(payload: object) {
        const msg = JSON.stringify(payload);
        wss.clients.forEach((client) => {
          const info = clients.get(client);
          if (client.readyState === WebSocket.OPEN && info?.roomId === clientInfo!.roomId) {
            client.send(msg);
          }
        });
      }

      // ── Update Log ───────────────────────────────────────────────────────
      if (message.type === "update_log") {
        const parsed = UpdateLogSchema.safeParse(message.payload);
        if (!parsed.success) return;

        const { userId, taskId, date, value, details } = parsed.data;

        // Verify ownership: the WS user can only log for themselves
        if (userId !== clientInfo.userId) return;

        try {
          const existingRes = await pool.query(
            "SELECT id FROM logs WHERE user_id = $1 AND task_id = $2 AND date = $3",
            [userId, taskId, date]
          );
          if (existingRes.rows[0]) {
            await pool.query("UPDATE logs SET value = $1, details = $2 WHERE id = $3", [
              value,
              details || null,
              existingRes.rows[0].id,
            ]);
          } else {
            await pool.query(
              "INSERT INTO logs (user_id, task_id, date, value, details) VALUES ($1, $2, $3, $4, $5)",
              [userId, taskId, date, value, details || null]
            );
          }
          broadcast({ type: "log_updated", payload: { userId, taskId, date, value, details } });
        } catch (err) {
          console.error("Update Log Error:", err);
        }
      }

      // ── Add Task ─────────────────────────────────────────────────────────
      if (message.type === "add_task") {
        const parsed = AddTaskSchema.safeParse(message.payload);
        if (!parsed.success) return;

        const { userId, title, type, targetDaily } = parsed.data;
        if (userId !== clientInfo.userId) return;

        const taskId = `${userId}_${Date.now()}`;
        try {
          const maxOrderRes = await pool.query(
            "SELECT COALESCE(MAX(sort_order), -1) as max_order FROM tasks WHERE user_id = $1",
            [userId]
          );
          const nextOrder = (maxOrderRes.rows[0]?.max_order ?? -1) + 1;

          await pool.query(
            "INSERT INTO tasks (id, user_id, title, type, target_daily, sort_order) VALUES ($1, $2, $3, $4, $5, $6)",
            [taskId, userId, title, type, targetDaily, nextOrder]
          );
          broadcast({ type: "task_added", payload: { ...message.payload, id: taskId, sort_order: nextOrder } });
        } catch (err) {
          console.error("Add Task Error:", err);
        }
      }

      // ── Delete Task ──────────────────────────────────────────────────────
      if (message.type === "delete_task") {
        const parsed = DeleteTaskSchema.safeParse(message.payload);
        if (!parsed.success) return;

        const { taskId } = parsed.data;
        try {
          // Verify task belongs to this user
          const taskRes = await pool.query("SELECT user_id FROM tasks WHERE id = $1", [taskId]);
          if (!taskRes.rows[0] || taskRes.rows[0].user_id !== clientInfo.userId) return;

          await pool.query("DELETE FROM tasks WHERE id = $1", [taskId]);
          broadcast({ type: "task_deleted", payload: { taskId } });
        } catch (err) {
          console.error("Delete Task Error:", err);
        }
      }

      // ── Reorder Tasks ────────────────────────────────────────────────────
      if (message.type === "reorder_tasks") {
        const schema = z.object({ taskIds: z.array(z.string()).min(1).max(50) });
        const parsed = schema.safeParse(message.payload);
        if (!parsed.success) return;

        const { taskIds } = parsed.data;
        try {
          for (let i = 0; i < taskIds.length; i++) {
            await pool.query(
              "UPDATE tasks SET sort_order = $1 WHERE id = $2 AND user_id = $3",
              [i, taskIds[i], clientInfo.userId]
            );
          }
          broadcast({ type: "tasks_reordered", payload: { taskIds, userId: clientInfo.userId } });
        } catch (err) {
          console.error("Reorder Tasks Error:", err);
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimeout);
      clients.delete(ws);
    });
  });

  // ── Vite / Static ─────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer();