import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import Database from "better-sqlite3";
import path from "path";
import "dotenv/config";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(process.env.DATABASE_PATH || "database.sqlite");
db.pragma('foreign_keys = ON');

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    room_id TEXT,
    FOREIGN KEY(room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL, -- 'sql', 'pyspark', 'project', 'custom'
    target_daily INTEGER DEFAULT 1,
    is_mandatory INTEGER DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    date TEXT NOT NULL, -- YYYY-MM-DD
    value INTEGER DEFAULT 0,
    details TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(task_id) REFERENCES tasks(id)
  );
`);

try {
  db.exec("ALTER TABLE users ADD COLUMN username TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)");
} catch (e) {
  // Column already exists
}

try {
  db.exec("ALTER TABLE logs ADD COLUMN details TEXT");
} catch (e) {
  // Column already exists or other error
}

try {
  db.exec("ALTER TABLE tasks ADD COLUMN is_mandatory INTEGER DEFAULT 1");
} catch (e) {
  // Column already exists or other error
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/ping", (req, res) => {
    res.json({ pong: true });
  });

  // API Routes
  app.get("/api/state/:roomId", (req, res) => {
    const { roomId } = req.params;
    const users = db.prepare("SELECT * FROM users WHERE room_id = ?").all(roomId);
    const userIds = users.map((u: any) => u.id);

    if (userIds.length === 0) {
      return res.json({ users: [], tasks: [], logs: [] });
    }

    const tasks = db.prepare(`SELECT * FROM tasks WHERE user_id IN (${userIds.map(() => '?').join(',')})`).all(...userIds);
    const logs = db.prepare(`SELECT * FROM logs WHERE user_id IN (${userIds.map(() => '?').join(',')})`).all(...userIds);

    res.json({ users, tasks, logs });
  });

  app.post("/api/init-user", (req, res) => {
    const { name, roomId, username } = req.body;
    if (!username || !name) {
      return res.status(400).json({ error: "Name and Username are required" });
    }

    const cleanUsername = username.toLowerCase().trim().replace(/^@/, '');

    // Ensure room exists
    db.prepare("INSERT OR IGNORE INTO rooms (id, name) VALUES (?, ?)").run(roomId, `Room ${roomId}`);

    // Check if username exists GLOBALLY
    let user = db.prepare("SELECT * FROM users WHERE username = ?").get(cleanUsername) as any;

    if (!user) {
      // Register New User
      const userId = `user_${Math.random().toString(36).substr(2, 9)}`;
      try {
        db.prepare("INSERT INTO users (id, name, username, room_id) VALUES (?, ?, ?, ?)").run(userId, name, cleanUsername, roomId);
        user = { id: userId, name, username: cleanUsername, room_id: roomId };

        // Default tasks for new user
        const defaultTasks = [
          { id: `${userId}_sql`, title: "SQL Practice (2 questions)", type: "sql", target: 2, is_mandatory: 1 },
          { id: `${userId}_pyspark`, title: "PySpark Learning", type: "pyspark", target: 1, is_mandatory: 1 },
          { id: `${userId}_project`, title: "DE Project Work", type: "project", target: 1, is_mandatory: 1 }
        ];
        const insertTask = db.prepare("INSERT INTO tasks (id, user_id, title, type, target_daily, is_mandatory) VALUES (?, ?, ?, ?, ?, ?)");
        defaultTasks.forEach(t => insertTask.run(t.id, userId, t.title, t.type, t.target, t.is_mandatory));

        return res.json({ success: true, userId: user.id });
      } catch (err) {
        return res.status(500).json({ error: "Failed to create user. Handle might be taken." });
      }
    } else {
      // Login Existing User
      // Full proof check: Does the provided name match the owner of this username?
      if (user.name.toLowerCase() !== name.toLowerCase()) {
        return res.status(401).json({
          error: `The handle '@${cleanUsername}' is already taken. Please choose a different username.`
        });
      }

      // Update room_id if they are joining a different room
      if (user.room_id !== roomId) {
        db.prepare("UPDATE users SET room_id = ? WHERE id = ?").run(roomId, user.id);
      }

      res.json({ success: true, userId: user.id });
    }
  });

  // WebSocket Logic
  const clients = new Map<WebSocket, { roomId: string; userId: string }>();

  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === "join") {
        clients.set(ws, { roomId: message.roomId, userId: message.userId });
      }

      if (message.type === "update_log") {
        const { userId, taskId, date, value, details } = message.payload;

        // Update DB
        const existing = db.prepare("SELECT id FROM logs WHERE user_id = ? AND task_id = ? AND date = ?").get(userId, taskId, date) as any;
        if (existing) {
          db.prepare("UPDATE logs SET value = ?, details = ? WHERE id = ?").run(value, details || null, existing.id);
        } else {
          db.prepare("INSERT INTO logs (user_id, task_id, date, value, details) VALUES (?, ?, ?, ?, ?)").run(userId, taskId, date, value, details || null);
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
      }

      if (message.type === "toggle_mandatory") {
        const { taskId, isMandatory } = message.payload;
        db.prepare("UPDATE tasks SET is_mandatory = ? WHERE id = ?").run(isMandatory ? 1 : 0, taskId);

        const clientInfo = clients.get(ws);
        if (clientInfo) {
          wss.clients.forEach((client) => {
            const info = clients.get(client);
            if (client.readyState === WebSocket.OPEN && info?.roomId === clientInfo.roomId) {
              client.send(JSON.stringify({
                type: "mandatory_toggled",
                payload: { taskId, isMandatory }
              }));
            }
          });
        }
      }

      if (message.type === "add_task") {
        const { userId, title, type, targetDaily } = message.payload;
        const taskId = `${userId}_${Date.now()}`;
        db.prepare("INSERT INTO tasks (id, user_id, title, type, target_daily, is_mandatory) VALUES (?, ?, ?, ?, ?, 1)").run(taskId, userId, title, type, targetDaily);

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
      }

      if (message.type === "delete_task") {
        const { taskId } = message.payload;
        console.log(`WebSocket: Deleting task ${taskId}`);
        db.prepare("DELETE FROM logs WHERE task_id = ?").run(taskId);
        db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);

        const clientInfo = clients.get(ws);
        if (clientInfo) {
          console.log(`Broadcasting task_deleted ${taskId} to room ${clientInfo.roomId}`);
          wss.clients.forEach((client) => {
            const info = clients.get(client);
            if (client.readyState === WebSocket.OPEN && info?.roomId === clientInfo.roomId) {
              client.send(JSON.stringify({
                type: "task_deleted",
                payload: { taskId }
              }));
            }
          });
        } else {
          console.error("No clientInfo found for socket attempting to delete task");
        }
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  // Leaderboard Logic
  app.get("/api/leaderboard", (req, res) => {
    try {
      const allUsers = db.prepare("SELECT id, name, room_id FROM users").all() as any[];
      const allTasks = db.prepare("SELECT id, user_id, target_daily FROM tasks WHERE is_mandatory = 1").all() as any[];
      const allLogs = db.prepare("SELECT user_id, task_id, date, value FROM logs").all() as any[];

      const leaderboard = allUsers.map(u => {
        const userTasks = allTasks.filter(t => t.user_id === u.id);
        const userLogs = allLogs.filter(l => l.user_id === u.id);

        if (userTasks.length === 0) return { ...u, streak: 0 };

        const datesWithLogs = [...new Set(userLogs.map(l => l.date))].sort().reverse();
        const completedDates: string[] = [];

        for (const date of datesWithLogs) {
          const isDayComplete = userTasks.every(task => {
            const log = userLogs.find(l => l.task_id === task.id && l.date === date);
            return (log?.value || 0) >= task.target_daily;
          });
          if (isDayComplete) {
            completedDates.push(date);
          }
        }

        let streak = 0;
        let current = new Date();
        current.setHours(23, 59, 59, 999); // End of today

        for (let i = 0; i < completedDates.length; i++) {
          const logDate = new Date(completedDates[i]);
          logDate.setHours(12, 0, 0, 0); // Middle of that day
          const diff = Math.floor((current.getTime() - logDate.getTime()) / (1000 * 3600 * 24));

          if (diff <= 1) {
            streak++;
            current = logDate;
            current.setHours(12, 0, 0, 0);
          } else {
            break;
          }
        }
        return { name: u.name, username: u.username, roomId: u.room_id, streak };
      });

      const sortedLeaderboard = leaderboard
        .filter(u => u.streak > 0)
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
    console.log(`Admin login attempt for username: ${username}`);
    if (username === "admin" && password === (process.env.ADMIN_PASSWORD || "admin123")) {
      console.log("Admin login successful");
      res.json({ success: true, token: "admin-token-xyz" });
    } else {
      console.log("Admin login failed: Invalid credentials");
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.get("/api/admin/data", (req, res) => {
    const token = req.headers.authorization;
    console.log(`Admin data request with token: ${token}`);
    if (token !== "admin-token-xyz") {
      console.log("Admin data request failed: Unauthorized");
      return res.status(403).send("Unauthorized");
    }

    try {
      const users = db.prepare("SELECT * FROM users").all();
      const tasks = db.prepare("SELECT * FROM tasks").all();
      const logs = db.prepare("SELECT * FROM logs").all();
      const rooms = db.prepare("SELECT * FROM rooms").all();
      console.log(`Admin data fetched: ${users.length} users, ${tasks.length} tasks, ${logs.length} logs`);
      res.json({ users, tasks, logs, rooms });
    } catch (err) {
      console.error("Error fetching admin data:", err);
      res.status(500).send("Internal Server Error");
    }
  });

  app.delete("/api/admin/user/:id", (req, res) => {
    const token = req.headers.authorization;
    if (token !== "admin-token-xyz") return res.status(403).send("Unauthorized");

    const { id } = req.params;
    console.log(`Deleting user ${id}`);

    try {
      const deleteTransaction = db.transaction(() => {
        db.prepare("DELETE FROM logs WHERE user_id = ?").run(id);
        db.prepare("DELETE FROM tasks WHERE user_id = ?").run(id);
        db.prepare("DELETE FROM users WHERE id = ?").run(id);
      });

      deleteTransaction();
      console.log(`User ${id} deleted successfully`);
      res.json({ success: true });
    } catch (err) {
      console.error(`Error deleting user ${id}:`, err);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  app.delete("/api/admin/log/:id", (req, res) => {
    const token = req.headers.authorization;
    if (token !== "admin-token-xyz") return res.status(403).send("Unauthorized");

    db.prepare("DELETE FROM logs WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/admin/task/:id", (req, res) => {
    const token = req.headers.authorization;
    if (token !== "admin-token-xyz") return res.status(403).send("Unauthorized");

    db.prepare("DELETE FROM logs WHERE task_id = ?").run(req.params.id);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
    res.json({ success: true });
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
