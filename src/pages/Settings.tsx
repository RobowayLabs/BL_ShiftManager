'use client';

import { useState, useEffect } from "react";
import { UserCog, Key, Plus, Pencil, UserX, Eye, EyeOff, ShieldCheck, ShieldOff, MonitorPlay } from "lucide-react";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { useAuth } from "../context/AuthContext";
import { useGuest } from "../context/GuestContext";
import {
  listUsers,
  createUser,
  updateUser,
  deactivateUser,
  changeOwnCredentials,
  type AppUser,
} from "../api/users";

// ─── helpers ──────────────────────────────────────────────────────────────────

function PwInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-xs font-semibold text-brand-text-muted uppercase mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-slate-800 border border-brand-border rounded-lg px-3 py-2 text-sm text-slate-100 pr-10 focus:outline-none focus:ring-1 focus:ring-brand-accent"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-text-muted hover:text-slate-300"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function StatusMsg({ msg, type }: { msg: string; type: "success" | "error" }) {
  if (!msg) return null;
  return (
    <p
      className={`text-xs font-medium mt-2 ${
        type === "success" ? "text-brand-success" : "text-brand-danger"
      }`}
    >
      {msg}
    </p>
  );
}

// ─── Change own credentials ───────────────────────────────────────────────────

function ChangeCredentialsSection() {
  const { user } = useAuth();
  const [oldPw, setOldPw] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const handleSave = async () => {
    if (!oldPw) return setMsg({ text: "Current password is required.", type: "error" });
    if (!newUsername && !newPw) return setMsg({ text: "Provide a new username or new password.", type: "error" });
    if (newPw && newPw !== confirmPw) return setMsg({ text: "New passwords do not match.", type: "error" });
    setSaving(true);
    setMsg(null);
    try {
      await changeOwnCredentials({ oldPassword: oldPw, newUsername: newUsername || undefined, newPassword: newPw || undefined });
      setMsg({ text: "Credentials updated successfully.", type: "success" });
      setOldPw(""); setNewUsername(""); setNewPw(""); setConfirmPw("");
    } catch (err: any) {
      setMsg({ text: err.message, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-slate-100">
        <Key className="w-5 h-5 text-brand-accent" />
        <h3 className="text-lg font-semibold">My Credentials</h3>
      </div>
      <div className="bg-brand-card border border-brand-border rounded-lg p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-brand-border">
          <div className="w-10 h-10 rounded-full bg-brand-accent/20 flex items-center justify-center text-brand-accent font-bold">
            {user?.username?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">{user?.username}</p>
            <p className="text-xs text-brand-text-muted capitalize">{user?.role?.replace("_", " ")}</p>
          </div>
        </div>

        <PwInput label="Current Password *" value={oldPw} onChange={setOldPw} placeholder="Enter current password" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-brand-text-muted uppercase mb-1.5">New Username</label>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Leave blank to keep current"
              className="w-full bg-slate-800 border border-brand-border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent"
            />
          </div>
          <div />
          <PwInput label="New Password" value={newPw} onChange={setNewPw} placeholder="Leave blank to keep current" />
          <PwInput label="Confirm New Password" value={confirmPw} onChange={setConfirmPw} placeholder="Repeat new password" />
        </div>

        {msg && <StatusMsg msg={msg.text} type={msg.type} />}

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? "Saving..." : "Update Credentials"}
          </Button>
        </div>
      </div>
    </section>
  );
}

// ─── User form modal ──────────────────────────────────────────────────────────

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing?: AppUser | null;
}

function UserFormModal({ isOpen, onClose, onSaved, editing }: UserFormModalProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [role, setRole] = useState<"super_admin" | "manager">("manager");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setUsername(editing?.username ?? "");
      setPassword("");
      setConfirmPw("");
      setRole(editing?.role ?? "manager");
      setMsg(null);
    }
  }, [isOpen, editing]);

  const handleSave = async () => {
    if (!editing && !username) return setMsg({ text: "Username is required.", type: "error" });
    if (!editing && !password) return setMsg({ text: "Password is required.", type: "error" });
    if (password && password !== confirmPw) return setMsg({ text: "Passwords do not match.", type: "error" });
    setSaving(true);
    setMsg(null);
    try {
      if (editing) {
        await updateUser(editing.id, {
          username: username || undefined,
          password: password || undefined,
          role,
        });
      } else {
        await createUser({ username, password, role });
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setMsg({ text: err.message, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? "Edit User" : "Add User"}
      footer={
        <div className="flex justify-end gap-2 w-full">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : editing ? "Save Changes" : "Create User"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-brand-text-muted uppercase mb-1.5">
            Username {editing && <span className="normal-case text-brand-text-muted/60">(leave blank to keep current)</span>}
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={editing ? editing.username : "Enter username"}
            className="w-full bg-slate-800 border border-brand-border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <PwInput
            label={editing ? "New Password" : "Password *"}
            value={password}
            onChange={setPassword}
            placeholder={editing ? "Leave blank to keep" : "Enter password"}
          />
          <PwInput
            label="Confirm Password"
            value={confirmPw}
            onChange={setConfirmPw}
            placeholder="Repeat password"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-brand-text-muted uppercase mb-1.5">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "super_admin" | "manager")}
            className="w-full bg-slate-800 border border-brand-border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent"
          >
            <option value="manager">Manager</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </div>

        {msg && <StatusMsg msg={msg.text} type={msg.type} />}
      </div>
    </Modal>
  );
}

// ─── User management table ────────────────────────────────────────────────────

function UserManagementSection() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [deactivating, setDeactivating] = useState<number | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<number | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await listUsers();
      setUsers(res.users);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleDeactivate = async (id: number) => {
    setDeactivating(id);
    try {
      await deactivateUser(id);
      setConfirmDeactivate(null);
      fetchUsers();
    } catch (_) {}
    setDeactivating(null);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-100">
          <UserCog className="w-5 h-5 text-brand-accent" />
          <h3 className="text-lg font-semibold">User Management</h3>
        </div>
        <Button size="sm" onClick={() => { setEditingUser(null); setModalOpen(true); }}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />Add User
        </Button>
      </div>

      <div className="bg-brand-card border border-brand-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-brand-text-muted text-sm">Loading users…</div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-800/50">
              <tr className="text-brand-text-muted text-[10px] uppercase tracking-wider">
                <th className="px-5 py-3 font-bold">Username</th>
                <th className="px-5 py-3 font-bold">Role</th>
                <th className="px-5 py-3 font-bold">Status</th>
                <th className="px-5 py-3 font-bold">Last Login</th>
                <th className="px-5 py-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border text-sm">
              {users.map((u) => {
                const isMe = String(u.id) === String(me?.id ?? "");
                return (
                  <tr key={u.id} className={`hover:bg-slate-800/30 transition-colors ${!u.active ? "opacity-50" : ""}`}>
                    <td className="px-5 py-3.5 font-medium text-slate-100 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-brand-accent/15 flex items-center justify-center text-brand-accent text-xs font-bold shrink-0">
                        {u.username[0].toUpperCase()}
                      </div>
                      {u.username}
                      {isMe && <span className="text-[10px] bg-brand-accent/10 text-brand-accent px-1.5 py-0.5 rounded border border-brand-accent/20 font-semibold">You</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      {u.role === "super_admin" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-accent">
                          <ShieldCheck className="w-3.5 h-3.5" />Super Admin
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                          <ShieldOff className="w-3.5 h-3.5" />Manager
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${u.active ? "bg-brand-success/10 text-brand-success border-brand-success/20" : "bg-slate-700/40 text-brand-text-muted border-brand-border"}`}>
                        {u.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-brand-text-muted text-xs">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleString() : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setEditingUser(u); setModalOpen(true); }}
                          className="p-1.5 rounded hover:bg-slate-700 text-brand-text-muted hover:text-slate-100 transition-colors"
                          title="Edit user"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {!isMe && u.active && (
                          confirmDeactivate === u.id ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-brand-danger font-medium">Confirm?</span>
                              <button
                                onClick={() => setConfirmDeactivate(null)}
                                className="text-[10px] px-2 py-0.5 rounded border border-brand-border text-brand-text-muted hover:text-slate-100 transition-colors"
                              >No</button>
                              <button
                                onClick={() => handleDeactivate(u.id)}
                                disabled={deactivating === u.id}
                                className="text-[10px] px-2 py-0.5 rounded border border-brand-danger/40 text-brand-danger hover:bg-brand-danger/10 transition-colors"
                              >{deactivating === u.id ? "…" : "Yes"}</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeactivate(u.id)}
                              className="p-1.5 rounded hover:bg-slate-700 text-brand-text-muted hover:text-brand-danger transition-colors"
                              title="Deactivate user"
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <UserFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={fetchUsers}
        editing={editingUser}
      />
    </section>
  );
}

// ─── Main Settings page ───────────────────────────────────────────────────────

export const Settings = () => {
  const { user } = useAuth();
  const { isGuest } = useGuest();
  const isSuperAdmin = user?.role === "super_admin";

  if (isGuest) {
    return (
      <div className="max-w-4xl space-y-10">
        <div className="bg-brand-card border border-yellow-500/20 rounded-xl p-10 flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-full bg-yellow-500/10 flex items-center justify-center">
            <MonitorPlay className="w-7 h-7 text-yellow-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-100">Settings unavailable in Guest Mode</p>
            <p className="text-sm text-brand-text-muted mt-1 max-w-sm">
              Credential changes and user management require a real account. Exit guest mode and sign in to access settings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-10">
      <ChangeCredentialsSection />

      {isSuperAdmin ? (
        <UserManagementSection />
      ) : (
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-slate-100">
            <UserCog className="w-5 h-5 text-brand-accent" />
            <h3 className="text-lg font-semibold">User Management</h3>
          </div>
          <div className="bg-brand-card border border-brand-border rounded-lg p-8 flex flex-col items-center gap-3 text-center">
            <ShieldOff className="w-8 h-8 text-brand-text-muted" />
            <p className="text-sm font-medium text-slate-300">Restricted</p>
            <p className="text-xs text-brand-text-muted max-w-xs">
              Only Super Admins can manage users. Contact a Super Admin to add or modify accounts.
            </p>
          </div>
        </section>
      )}
    </div>
  );
};
