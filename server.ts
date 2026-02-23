import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { Pool } from "pg";
import path from "path";
import "dotenv/config";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000, // 10 seconds timeout
  idleTimeoutMillis: 30000,
  max: 20
});

let isDbReady = false;

// Initialize Database with retry logic
const initDb = async (retries = 5) => {
  while (retries > 0) {
    let client;
    try {
      console.log(`Attempting to connect to database... (${retries} retries left)`);
      client = await pool.connect();
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

        CREATE TABLE IF NOT EXISTS logs (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          value INTEGER DEFAULT 0,
          details TEXT
        );

        DROP TABLE IF EXISTS task_mandatory_settings;
      `);
      console.log("Database initialized successfully - Mandatory features removed");
      isDbReady = true;
      return; // Success!
    } catch (err) {
      console.error("Database initialization error:", err);
      retries--;
      if (retries === 0) {
        console.error("Max retries reached. Some features may not work.");
        return;
      }
      console.log("Retrying in 5 seconds...");
      await new Promise(res => setTimeout(res, 5000));
    } finally {
      if (client) client.release();
    }
  }
};

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Health check for Render
  app.get("/health", (req, res) => {
    res.json({
      status: "online",
      database: isDbReady ? "connected" : "connecting"
    });
  });

  app.get("/api/ping", (req, res) => {
    res.json({ pong: true, isDbReady });
  });

  // Start initialization in background
  initDb();

  // Middleware to block API requests until DB is ready
  const dbGuard = (req: any, res: any, next: any) => {
    if (!isDbReady) {
      return res.status(503).json({ error: "Database is initializing. Please try again in a few seconds." });
    }
    next();
  };

  // API Routes
  app.get("/api/state/:roomId", dbGuard, async (req, res) => {
    const { roomId } = req.params;
    try {
      const usersRes = await pool.query("SELECT * FROM users WHERE room_id = $1", [roomId]);
      const users = usersRes.rows;
      const userIds = users.map((u: any) => u.id);

      if (userIds.length === 0) {
        return res.json({ users: [], tasks: [], logs: [] });
      }

      const tasksRes = await pool.query(`SELECT * FROM tasks WHERE user_id = ANY($1)`, [userIds]);
      const logsRes = await pool.query(`SELECT * FROM logs WHERE user_id = ANY($1)`, [userIds]);

      res.json({
        users,
        tasks: tasksRes.rows,
        logs: logsRes.rows
      });
    } catch (err) {
      console.error("Error fetching state:", err);
      res.status(500).send("Internal Server Error");
    }
  });

  app.post("/api/init-user", async (req, res) => {
    const { name, roomId, username } = req.body;
    if (!username || !name) {
      return res.status(400).json({ error: "Name and Username are required" });
    }

    const cleanUsername = username.toLowerCase().trim().replace(/^@/, '');

    try {
      // Ensure room exists
      await pool.query("INSERT INTO rooms (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [roomId, `Room ${roomId}`]);

      // Check if username exists GLOBALLY
      const userRes = await pool.query("SELECT * FROM users WHERE username = $1", [cleanUsername]);
      let user = userRes.rows[0];

      if (!user) {
        // Register New User
        const userId = `user_${Math.random().toString(36).substr(2, 9)}`;
        await pool.query("INSERT INTO users (id, name, username, room_id) VALUES ($1, $2, $3, $4)", [userId, name, cleanUsername, roomId]);

        // Default tasks for new user
        const defaultTasks = [
          { id: `${userId}_sql`, title: "SQL Practice (2 questions)", type: "sql", target: 2 },
          { id: `${userId}_pyspark`, title: "PySpark Learning", type: "pyspark", target: 1 },
          { id: `${userId}_project`, title: "DE Project Work", type: "project", target: 1 }
        ];

        for (const t of defaultTasks) {
          await pool.query("INSERT INTO tasks (id, user_id, title, type, target_daily) VALUES ($1, $2, $3, $4, $5)",
            [t.id, userId, t.title, t.type, t.target]);
        }

        return res.json({ success: true, userId: userId });
      } else {
        // Login Existing User
        if (user.name.toLowerCase() !== name.toLowerCase()) {
          return res.status(401).json({
            error: `The handle '@${cleanUsername}' is already taken. Please choose a different username.`
          });
        }

        // Update room_id if they are joining a different room
        if (user.room_id !== roomId) {
          await pool.query("UPDATE users SET room_id = $1 WHERE id = $2", [roomId, user.id]);
        }

        res.json({ success: true, userId: user.id });
      }
    } catch (err) {
      console.error("Init User Error:", err);
      res.status(500).json({ error: "Failed to initialize user" });
    }
  });

  // WebSocket Logic
  const clients = new Map<WebSocket, { roomId: string; userId: string }>();

  wss.on("connection", (ws) => {
    ws.on("message", async (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === "join") {
        clients.set(ws, { roomId: message.roomId, userId: message.userId });
      }

      if (message.type === "update_log") {
        const { userId, taskId, date, value, details } = message.payload;

        try {
          // Update DB
          const existingRes = await pool.query("SELECT id FROM logs WHERE user_id = $1 AND task_id = $2 AND date = $3", [userId, taskId, date]);
          const existing = existingRes.rows[0];

          if (existing) {
            await pool.query("UPDATE logs SET value = $1, details = $2 WHERE id = $3", [value, details || null, existing.id]);
          } else {
            await pool.query("INSERT INTO logs (user_id, task_id, date, value, details) VALUES ($1, $2, $3, $4, $5)", [userId, taskId, date, value, details || null]);
          }

          // Broadcast to room
          const clientInfo = clients.get(ws);
          if (clientInfo) {
            wss.clients.forEach((client) => {
              const info = clients.get(client);
              if (client.readyState === WebSocket.OPEN && info?.roomId === clientInfo.roomId) {
                client.send(JSON.stringify({
                  type: "log_updated",
                  payload: message.payload
                }));
              }
            });
          }
        } catch (err) {
          console.error("Update Log Error:", err);
        }
      }

      if (message.type === "add_task") {
        const { userId, title, type, targetDaily } = message.payload;
        const taskId = `${userId}_${Date.now()}`;
        try {
          await pool.query("INSERT INTO tasks (id, user_id, title, type, target_daily) VALUES ($1, $2, $3, $4, $5)",
            [taskId, userId, title, type, targetDaily]);

          const clientInfo = clients.get(ws);
          if (clientInfo) {
            wss.clients.forEach((client) => {
              const info = clients.get(client);
              if (client.readyState === WebSocket.OPEN && info?.roomId === clientInfo.roomId) {
                client.send(JSON.stringify({
                  type: "task_added",
                  payload: { ...message.payload, id: taskId }
                }));
              }
            });
          }
        } catch (err) {
          console.error("Add Task Error:", err);
        }
      }

      if (message.type === "delete_task") {
        const { taskId } = message.payload;
        console.log(`WebSocket: Attempting to delete task ${taskId}`);
        try {
          // With CASCADE, we only need to delete the task itself
          const res = await pool.query("DELETE FROM tasks WHERE id = $1", [taskId]);
          console.log(`Task ${taskId} deletion result: ${res.rowCount} rows affected`);

          const clientInfo = clients.get(ws);
          if (clientInfo) {
            wss.clients.forEach((client) => {
              const info = clients.get(client);
              if (client.readyState === WebSocket.OPEN && info?.roomId === clientInfo.roomId) {
                client.send(JSON.stringify({
                  type: "task_deleted",
                  payload: { taskId }
                }));
              }
            });
          }
        } catch (err) {
          console.error(`Delete Task Error (${taskId}):`, err);
        }
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  // Leaderboard Logic
  app.get("/api/leaderboard", async (req, res) => {
    try {
      const allUsersRes = await pool.query("SELECT id, name, username, room_id FROM users");
      const allTasksRes = await pool.query("SELECT id, user_id, target_daily FROM tasks");
      const allLogsRes = await pool.query("SELECT user_id, task_id, date, value FROM logs");

      const allUsers = allUsersRes.rows;
      const allTasks = allTasksRes.rows;
      const allLogs = allLogsRes.rows;

      const leaderboard = allUsers.map(u => {
        const userTasks = allTasks.filter(t => t.user_id === u.id);
        const userLogs = allLogs.filter(l => l.user_id === u.id);

        if (userTasks.length === 0) return { ...u, streak: 0 };

        const datesWithLogs = [...new Set(userLogs.map(l => l.date))].sort().reverse() as string[];
        const completedDates: { date: string, points: number }[] = [];

        for (const date of datesWithLogs) {
          const dayTasks = userTasks.map(task => {
            const log = userLogs.find(l => l.task_id === task.id && l.date === date);
            return { target: task.target_daily, value: log?.value || 0 };
          });

          const isAnyTaskComplete = dayTasks.some(t => t.value >= t.target);
          if (isAnyTaskComplete) {
            const isBonusEarned = dayTasks.some(t => t.value >= t.target * 5);
            completedDates.push({ date, points: isBonusEarned ? 2 : 1 });
          }
        }

        let streak = 0;
        const now = new Date();
        const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0));
        let current = today;

        for (let i = 0; i < completedDates.length; i++) {
          const [y, m, d] = completedDates[i].date.split('-').map(Number);
          const logDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

          const diff = Math.floor((current.getTime() - logDate.getTime()) / (1000 * 3600 * 24));

          if (diff <= 1) {
            streak += completedDates[i].points;
            current = logDate;
          } else {
            break;
          }
        }
        return { name: u.name, username: u.username, roomId: u.room_id, streak };
      });

      const sortedLeaderboard = leaderboard
        .filter((u: any) => u.streak > 0)
        .sort((a, b) => b.streak - a.streak)
        .slice(0, 5);

      res.json({ leaderboard: sortedLeaderboard });
    } catch (err) {
      console.error("Leaderboard Error:", err);
      res.status(500).json({ error: "Failed to generate leaderboard" });
    }
  });

  // Admin Routes
  app.post("/api/admin/login", (req, res) => {
    const { username, password } = req.body;
    if (username === "admin" && password === (process.env.ADMIN_PASSWORD || "admin123")) {
      res.json({ success: true, token: "admin-token-xyz" });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.get("/api/admin/data", async (req, res) => {
    const token = req.headers.authorization;
    if (token !== "admin-token-xyz") {
      return res.status(403).send("Unauthorized");
    }

    try {
      const users = (await pool.query("SELECT * FROM users")).rows;
      const tasks = (await pool.query("SELECT * FROM tasks")).rows;
      const logs = (await pool.query("SELECT * FROM logs")).rows;
      const rooms = (await pool.query("SELECT * FROM rooms")).rows;
      res.json({ users, tasks, logs, rooms });
    } catch (err) {
      console.error("Error fetching admin data:", err);
      res.status(500).send("Internal Server Error");
    }
  });

  app.delete("/api/admin/user/:id", async (req, res) => {
    const token = req.headers.authorization;
    if (token !== "admin-token-xyz") return res.status(403).send("Unauthorized");

    const { id } = req.params;
    console.log(`Admin: Attempting to delete user ${id}`);
    try {
      // With CASCADE, deleting user deletes everything else
      const result = await pool.query("DELETE FROM users WHERE id = $1", [id]);
      console.log(`User ${id} deletion result: ${result.rowCount} rows affected`);
      res.json({ success: true });
    } catch (err) {
      console.error(`Error deleting user ${id}:`, err);
      res.status(500).json({ error: "Failed to delete user", details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/admin/log/:id", async (req, res) => {
    const token = req.headers.authorization;
    if (token !== "admin-token-xyz") return res.status(403).send("Unauthorized");

    try {
      await pool.query("DELETE FROM logs WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).send("Error deleting log");
    }
  });

  app.delete("/api/admin/task/:id", async (req, res) => {
    const token = req.headers.authorization;
    if (token !== "admin-token-xyz") return res.status(403).send("Unauthorized");

    const { id } = req.params;
    console.log(`Admin: Attempting to delete task ${id}`);
    try {
      // With CASCADE, deleting task deletes its logs
      const result = await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
      console.log(`Task ${id} deletion result: ${result.rowCount} rows affected`);
      res.json({ success: true });
    } catch (err) {
      console.error(`Error deleting task ${id}:`, err);
      res.status(500).json({ error: "Failed to delete task", details: err instanceof Error ? err.message : String(err) });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
