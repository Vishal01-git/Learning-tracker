import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import Database from "better-sqlite3";
import path from "path";
import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
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
    const { name, roomId } = req.body;

    // Ensure room exists
    db.prepare("INSERT OR IGNORE INTO rooms (id, name) VALUES (?, ?)").run(roomId, `Room ${roomId}`);

    // Check if user exists in this room
    let user = db.prepare("SELECT * FROM users WHERE name = ? AND room_id = ?").get(name, roomId) as any;

    if (!user) {
      const userId = `user_${Math.random().toString(36).substr(2, 9)}`;
      db.prepare("INSERT INTO users (id, name, room_id) VALUES (?, ?, ?)").run(userId, name, roomId);
      user = { id: userId, name, room_id: roomId };

      // Default tasks for new user
      const defaultTasks = [
        { id: `${userId}_sql`, title: "SQL Practice (2 questions)", type: "sql", target: 2, is_mandatory: 1 },
        { id: `${userId}_pyspark`, title: "PySpark Learning", type: "pyspark", target: 1, is_mandatory: 1 },
        { id: `${userId}_project`, title: "DE Project Work", type: "project", target: 1, is_mandatory: 1 }
      ];
      const insertTask = db.prepare("INSERT INTO tasks (id, user_id, title, type, target_daily, is_mandatory) VALUES (?, ?, ?, ?, ?, ?)");
      defaultTasks.forEach(t => insertTask.run(t.id, userId, t.title, t.type, t.target, t.is_mandatory));
    }

    res.json({ success: true, userId: user.id });
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

  // Gemini AI Tip Generator
  const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
  const model = genAI?.getGenerativeModel({ model: "gemini-1.5-flash" });

  app.get("/api/tips", async (req, res) => {
    if (!model) {
      return res.json({
        tips: [
          "Focus on Window Functions in SQL",
          "Understand PySpark RDD vs Dataframes",
          "Document your project architecture",
          "Practice LeetCode Hard SQL weekly"
        ]
      });
    }

    try {
      const prompt = `You are a world-class learning coach. 
      Generate 4 concise, high-impact daily study/learning tips for someone trying to master new technical skills and maintain consistency. 
      Focus on productivity, memory retention, and habit building. 
      Keep each tip under 15 words. Return only the tips as a JSON list of strings.`;

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      // Basic JSON extraction from markdown
      const jsonMatch = text.match(/\[.*\]/s);
      const tips = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      res.json({ tips });
    } catch (err) {
      console.error("Gemini Error:", err);
      res.json({ tips: ["Focus on Window Functions in SQL", "Understand PySpark RDD vs Dataframes"] });
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
