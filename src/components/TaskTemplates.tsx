import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Layers, X, Check } from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string;
  emoji: string;
  tasks: { title: string; type: "sql" | "pyspark" | "project" | "custom"; target: number }[];
}

const TEMPLATES: Template[] = [
  {
    id: "de-core",
    name: "Data Engineering Core",
    description: "The essentials for a DE job hunt",
    emoji: "🏗️",
    tasks: [
      { title: "SQL Practice (2 questions)", type: "sql", target: 2 },
      { title: "PySpark Learning", type: "pyspark", target: 1 },
      { title: "DE Project Work", type: "project", target: 1 },
    ],
  },
  {
    id: "sql-intensive",
    name: "SQL Intensive",
    description: "Grind SQL until it's second nature",
    emoji: "🗄️",
    tasks: [
      { title: "LeetCode SQL (Hard)", type: "sql", target: 1 },
      { title: "Window Functions Practice", type: "sql", target: 2 },
      { title: "Query Optimization Study", type: "sql", target: 1 },
    ],
  },
  {
    id: "spark-deep-dive",
    name: "Spark Deep Dive",
    description: "Master distributed computing with PySpark",
    emoji: "⚡",
    tasks: [
      { title: "PySpark Chapter (Reading)", type: "pyspark", target: 1 },
      { title: "Spark Exercise", type: "pyspark", target: 1 },
      { title: "Performance Tuning Research", type: "pyspark", target: 1 },
    ],
  },
  {
    id: "full-stack-de",
    name: "Full Stack DE",
    description: "End-to-end pipeline engineering",
    emoji: "🔄",
    tasks: [
      { title: "SQL Practice", type: "sql", target: 2 },
      { title: "PySpark / Python Script", type: "pyspark", target: 1 },
      { title: "Airflow DAG Work", type: "project", target: 1 },
      { title: "System Design Study", type: "custom", target: 1 },
    ],
  },
  {
    id: "interview-prep",
    name: "Interview Prep",
    description: "Targeted prep for DE interviews",
    emoji: "🎯",
    tasks: [
      { title: "SQL Interview Question", type: "sql", target: 3 },
      { title: "Data Modeling Practice", type: "project", target: 1 },
      { title: "Behavioral Story Prep", type: "custom", target: 1 },
    ],
  },
];

interface TaskTemplatesProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (tasks: { title: string; type: "sql" | "pyspark" | "project" | "custom"; target: number }[]) => void;
}

export function TaskTemplates({ isOpen, onClose, onApply }: TaskTemplatesProps) {
  const [selected, setSelected] = React.useState<string | null>(null);

  const handleApply = () => {
    const template = TEMPLATES.find((t) => t.id === selected);
    if (template) {
      onApply(template.tasks);
      onClose();
      setSelected(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="bg-[#1A1A1A] w-full max-w-lg rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/5 rounded-xl">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base">Task Templates</h3>
                  <p className="text-[11px] text-white/40">Start with a pre-built track</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-2">
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelected(template.id === selected ? null : template.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    selected === template.id
                      ? "bg-emerald-500/10 border-emerald-500/40"
                      : "bg-[#2A2A2A]/50 border-white/5 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{template.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">{template.name}</span>
                        {selected === template.id && (
                          <span className="text-emerald-400">
                            <Check className="w-4 h-4" />
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/40 mt-0.5 mb-2">{template.description}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {template.tasks.map((t, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 bg-white/5 rounded-md text-white/50 border border-white/10">
                            {t.title}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="p-4 border-t border-white/5">
              <div className="text-[10px] text-white/30 mb-3 text-center">
                ⚠️ This will add these tasks to your existing tasks, not replace them
              </div>
              <motion.button
                whileHover={{ scale: selected ? 1.02 : 1 }}
                whileTap={{ scale: selected ? 0.98 : 1 }}
                onClick={handleApply}
                disabled={!selected}
                className="w-full py-3 bg-white text-black rounded-xl font-bold text-sm hover:bg-white/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Apply Template
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}