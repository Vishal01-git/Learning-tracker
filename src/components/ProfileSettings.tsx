import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  User, Download, Save, X, AlertCircle, CheckCircle,
  Bell, BellOff, Send, Loader2,
} from "lucide-react";

interface ProfileSettingsProps {
  user: { id: string; name: string; username?: string; room_id: string };
  token: string;
  onClose: () => void;
  onUpdate: (newName: string, newRoomId: string, newToken: string) => void;
}

// Helper: convert base64url string to Uint8Array (needed for VAPID public key)
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function ProfileSettings({ user, token, onClose, onUpdate }: ProfileSettingsProps) {
  const [name, setName] = useState(user.name);
  const [roomId, setRoomId] = useState(user.room_id);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // ── Push notification state ──────────────────────────────────────────────────
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);

  // Check push support and current subscription status on mount
  useEffect(() => {
    const checkPushStatus = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushSupported(false);
        return;
      }
      setPushSupported(true);
      setPushPermission(Notification.permission);

      // Check if already subscribed
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setPushSubscribed(!!sub);
      } catch {
        setPushSubscribed(false);
      }
    };
    checkPushStatus();
  }, []);

  // ── Push: enable notifications ───────────────────────────────────────────────
  const handleEnablePush = async () => {
    setPushLoading(true);
    setStatus(null);
    try {
      // 1. Get VAPID public key from server
      const vapidRes = await fetch("/api/push/vapid-public-key");
      if (!vapidRes.ok) {
        setStatus({ type: "error", msg: "Push notifications are not configured on this server yet." });
        return;
      }
      const { publicKey } = await vapidRes.json();

      // 2. Request notification permission
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      if (permission !== "granted") {
        setStatus({ type: "error", msg: "Notification permission denied. Enable it in your browser settings." });
        return;
      }

      // 3. Get the service worker registration and subscribe
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // 4. Send subscription to server
      const subJson = subscription.toJSON();
      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys?.p256dh,
            auth: subJson.keys?.auth,
          },
        }),
      });

      if (!saveRes.ok) {
        const data = await saveRes.json();
        setStatus({ type: "error", msg: data.error || "Failed to save subscription." });
        return;
      }

      setPushSubscribed(true);
      setStatus({ type: "success", msg: "Notifications enabled! Use the test button to verify." });
    } catch (err: any) {
      setStatus({ type: "error", msg: err?.message || "Failed to enable notifications." });
    } finally {
      setPushLoading(false);
    }
  };

  // ── Push: disable notifications ──────────────────────────────────────────────
  const handleDisablePush = async () => {
    setPushLoading(true);
    setStatus(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();

      if (subscription) {
        // Remove from server first
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        // Then unsubscribe locally
        await subscription.unsubscribe();
      }

      setPushSubscribed(false);
      setStatus({ type: "success", msg: "Notifications disabled." });
    } catch (err: any) {
      setStatus({ type: "error", msg: err?.message || "Failed to disable notifications." });
    } finally {
      setPushLoading(false);
    }
  };

  // ── Push: send test notification ─────────────────────────────────────────────
  const handleTestPush = async () => {
    setIsSendingTest(true);
    setStatus(null);
    try {
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setStatus({ type: "success", msg: "Test notification sent! Check your notifications." });
      } else {
        setStatus({ type: "error", msg: data.error || "Failed to send test notification." });
      }
    } catch {
      setStatus({ type: "error", msg: "Connection error." });
    } finally {
      setIsSendingTest(false);
    }
  };

  // ── Profile save ─────────────────────────────────────────────────────────────
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

  // ── Export ───────────────────────────────────────────────────────────────────
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
        className="bg-[#1A1A1A] w-full max-w-md rounded-2xl shadow-2xl border border-white/10 overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between sticky top-0 bg-[#1A1A1A] z-10">
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

          {/* Status message */}
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

          {/* Save button */}
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

          {/* ── Notifications section ─────────────────────────────────────── */}
          <div className="border-t border-white/5 pt-4">
            <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-3">
              Notifications
            </div>

            {!pushSupported ? (
              <div className="p-3 bg-white/5 rounded-xl text-[11px] text-white/30 text-center">
                Push notifications are not supported in this browser.
              </div>
            ) : pushPermission === "denied" ? (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-[11px] text-red-400 text-center leading-relaxed">
                Notifications are blocked. Open your browser settings and allow notifications for this site, then refresh.
              </div>
            ) : (
              <div className="space-y-2">
                {/* Enable / Disable toggle */}
                <button
                  onClick={pushSubscribed ? handleDisablePush : handleEnablePush}
                  disabled={pushLoading}
                  className={`w-full py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 border ${
                    pushSubscribed
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                      : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {pushLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {pushSubscribed ? "Disabling..." : "Enabling..."}
                    </>
                  ) : pushSubscribed ? (
                    <>
                      <Bell className="w-4 h-4" />
                      Notifications Enabled
                    </>
                  ) : (
                    <>
                      <BellOff className="w-4 h-4" />
                      Enable Notifications
                    </>
                  )}
                </button>

                {/* Test notification button — only shown when subscribed */}
                {pushSubscribed && (
                  <button
                    onClick={handleTestPush}
                    disabled={isSendingTest}
                    className="w-full py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 text-white/50 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSendingTest ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        Send Test Notification
                      </>
                    )}
                  </button>
                )}

                <p className="text-[10px] text-white/20 text-center leading-relaxed">
                  {pushSubscribed
                    ? "You'll receive daily reminders to log your practice."
                    : "Get daily reminders to keep your streak alive."}
                </p>
              </div>
            )}
          </div>

          {/* ── Data section ─────────────────────────────────────────────── */}
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