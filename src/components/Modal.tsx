import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { Button } from "./Button";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal = ({ isOpen, onClose, title, children, footer }: ModalProps) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-brand-card border border-brand-border rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between p-4 border-bottom border-brand-border bg-slate-800/50">
              <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
              <Button variant="ghost" size="sm" onClick={onClose} className="p-1 h-auto">
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="p-6">
              {children}
            </div>
            {footer && (
              <div className="flex justify-end gap-3 p-4 bg-slate-800/50 border-t border-brand-border">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
