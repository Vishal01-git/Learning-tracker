# 🚀 Learning Tracker

A premium, high-performance web application designed for consistent skill-building. Whether you're mastering Data Engineering, practicing SQL, or building projects, Learning Tracker keeps you on course with a beautiful UI, collaborative features, and a global leaderboard.

![License](https://img.shields.io/badge/license-Apache--2.0-emerald)
![React](https://img.shields.io/badge/React-18-blue)
![SQLite](https://img.shields.io/badge/SQLite-3-lightblue)
![PWA](https://img.shields.io/badge/PWA-Ready-orange)

## ✨ Core Features

### 📊 Advanced Consistency Heatmap
- **GitHub-style Visualization**: Track your aggregate progress over a 1-year (Desktop) or 3-month (Mobile) window.
- **5-Level Intensity Grading**: Visual feedback based on the percentage of mandatory goals completed each day.
- **Interactive Matrix**: Click any square in the matrix to jump to that date and manage historical progress.

### 🏆 Collaborative Ecosystem
- **Unique Handles**: Secure, passwordless login using unique usernames (e.g., @alex_chen).
- **Real-time Syncing**: Built on WebSockets for instantaneous updates across all members in a "Room".
- **Global Leaderboard**: Compete with students and developers globally with live streak tracking.
- **Unified Activity Stream**: (Admin) View a live log of all progress updates across the platform.

### 📱 Full Mobile Support (PWA)
- **Installable App**: Native-like experience on Android and iOS with dedicated home screen icon.
- **Themed Status Bar**: Seamless integration with the mobile OS using professional `#1A1A1A` thematic colors.
- **Optimized UI**: Fully responsive layouts, from desktop dashboards to mobile checklists.

### ⚙️ Ultimate Customization
- **Flexible Streak Logic**: Decide which tasks are "Mandatory" for your streak and which are just for practice.
- **Full Task Control**: Add, Edit, or Delete any task—including defaults—to tailor the app to your curriculum.
- **Edit Logs**: Accidentally logged the wrong value? Edit any past entry, including details and progress counts.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Tailwind CSS, Framer Motion (Animations), Konva (Canvas Heatmap).
- **Backend**: Express (Node.js), WebSocket (Syncing), better-sqlite3 (Database).
- **Deployment**: Docker, PWA manifest for mobile.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18 or higher.

### Installation

1. **Clone & Install**:
   ```bash
   git clone https://github.com/Vishal01-git/Learning-tracker.git
   cd Learning-tracker
   npm install
   ```

2. **Environment Setup**:
   Create a `.env` file in the root:
   ```env
   ADMIN_PASSWORD=your_admin_password
   DATABASE_PATH=your_supabase_string
   ```

3. **Run Locally**:
   ```bash
   npm run dev
   ```
   Visit `http://localhost:3000` to start tracking!

---

## 🛡️ Admin Controls
Access the secure Admin Dashboard by clicking the "Admin Access" link at the bottom of the join screen.
- Manage all users in the SQLite database.
- Audit or delete progress logs by handle.
- Reset task targets for a fresh start.

---
*Built with passion for the learning community.*
