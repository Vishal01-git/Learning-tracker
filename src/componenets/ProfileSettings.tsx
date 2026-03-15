import React, { useState } from "react";
import { motion } from "framer-motion";
import { User, Download, Save, X, AlertCircle, CheckCircle } from "lucide-react";

interface ProfileSettingsProps {
  user: { id: string; name: string; username?: string; room_id: string };
  token: string;
  onClose: () => void;
  onUpdate: (newName: string, newRoomId: string, newToken: string) => void;
}

export function ProfileSettings({ user, token, onClose, onUpdate }: ProfileSettingsProps) {
  const [name, setName] = useState(user.name);
  const [roomId, setRoomId] = useState(user.room_id);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: name.trim(), roomId: roomId.trim() || "default" }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus({ type: "success", msg: "Profile updated!" });
        onUpdate(name.trim(), roomId.trim() || "default", data.token);
      } else {
        setStatus({ type: "error", msg: data.error || "Failed to save" });
      }
    } catch {
      setStatus({ type: "error", msg: "Connection error" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/export", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `learning-tracker-export-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      setStatus({ type: "error", msg: "Export failed" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-[#1A1A1A] w-full max-w-md rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
      >
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/5 rounded-xl">
              <User className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-lg">Profile & Settings</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Username (read-only) */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">
              Username (cannot change)
            </label>
            <div className="w-full px-4 py-3 bg-[#2A2A2A]/50 rounded-xl text-white/40 text-sm cursor-not-allowed border border-white/5">
              @{user.username}
            </div>
          </div>

          {/* Display name */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">
              Display Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              className="w-full px-4 py-3 bg-[#2A2A2A] rounded-xl outline-none focus:ring-2 focus:ring-white text-white transition-all"
              placeholder="Your display name"
            />
          </div>

          {/* Room ID */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">
              Room ID
            </label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              maxLength={50}
              className="w-full px-4 py-3 bg-[#2A2A2A] rounded-xl outline-none focus:ring-2 focus:ring-white text-white transition-all"
              placeholder="e.g. default, team-alpha"
            />
            <p className="text-[10px] text-white/30 mt-1.5 ml-1">
              Changing room ID will move you to a new room. Share the same ID to collaborate.
            </p>
          </div>

          {/* Status */}
          {status && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium ${
                status.type === "success"
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border border-red-500/20"
              }`}
            >
              {status.type === "success" ? (
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              )}
              {status.msg}
            </motion.div>
          )}

          {/* Save */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="w-full py-3 bg-white text-black rounded-xl font-bold text-sm hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </motion.button>

          {/* Divider */}
          <div className="border-t border-white/5 pt-4">
            <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-3">Data</div>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="w-full py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-white/60 hover:text-white"
            >
              {isExporting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export My Data (JSON)
                </>
              )}
            </button>
            <p className="text-[10px] text-white/20 mt-1.5 text-center">
              Downloads all your tasks, logs, and Feynman notes
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}