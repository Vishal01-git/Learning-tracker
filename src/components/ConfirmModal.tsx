import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const variantStyles = {
    danger: "bg-red-500 hover:bg-red-600 text-white",
    warning: "bg-yellow-500 hover:bg-yellow-600 text-black",
    default: "bg-white hover:bg-white/90 text-black",
  };

  const iconColor = {
    danger: "text-red-400",
    warning: "text-yellow-400",
    default: "text-white/40",
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="bg-[#1A1A1A] w-full max-w-sm rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
          >
            <div className="p-6">
              <div className="flex items-start gap-4 mb-6">
                <div className={`p-2 rounded-xl bg-white/5 ${iconColor[variant]}`}>
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-base mb-1">{title}</h3>
                  <p className="text-sm text-white/60 leading-relaxed">{message}</p>
                </div>
                <button
                  onClick={onCancel}
                  className="p-1 hover:bg-white/5 rounded-lg transition-colors text-white/40"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onCancel}
                  className="flex-1 py-2.5 text-sm font-bold bg-white/5 hover:bg-white/10 rounded-xl transition-colors"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-colors ${variantStyles[variant]}`}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}