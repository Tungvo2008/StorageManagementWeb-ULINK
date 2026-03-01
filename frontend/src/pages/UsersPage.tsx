import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { apiJson } from "../api/client";
import { getCurrentUsername } from "../auth";
import Modal from "../components/Modal";
import type { UserAccount } from "../types";

type UserCreateDraft = {
  username: string;
  password: string;
  is_active: boolean;
};

type UserEditDraft = {
  username: string;
  password: string;
  is_active: boolean;
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<UserAccount | null>(null);

  const [createForm, setCreateForm] = useState<UserCreateDraft>({
    username: "",
    password: "",
    is_active: true,
  });
  const [editForm, setEditForm] = useState<UserEditDraft>({
    username: "",
    password: "",
    is_active: true,
  });

  const currentUsername = useMemo(() => getCurrentUsername(), []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<UserAccount[]>("/api/v1/users");
      setUsers(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openEdit(user: UserAccount) {
    setSelected(user);
    setEditForm({
      username: user.username,
      password: "",
      is_active: user.is_active,
    });
    setEditOpen(true);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiJson<UserAccount>("/api/v1/users", {
        method: "POST",
        body: JSON.stringify({
          username: createForm.username.trim(),
          password: createForm.password,
          is_active: createForm.is_active,
        }),
      });
      setCreateForm({ username: "", password: "", is_active: true });
      setAddOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onEdit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    try {
      await apiJson<UserAccount>(`/api/v1/users/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          username: editForm.username.trim(),
          password: editForm.password.trim() || undefined,
          is_active: editForm.is_active,
        }),
      });
      setEditOpen(false);
      setSelected(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDelete(user: UserAccount) {
    const ok = window.confirm(`Xoá user "${user.username}"?`);
    if (!ok) return;
    setError(null);
    try {
      await apiJson<void>(`/api/v1/users/${user.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Users</h2>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn primary" type="button" onClick={() => setAddOpen(true)}>
            + User
          </button>
          <button className="btn" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        Quản lý tài khoản đăng nhập hệ thống.
      </div>
      {error && <div className="error">{error}</div>}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Active</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = Boolean(currentUsername) && user.username.toLowerCase() === currentUsername.toLowerCase();
              return (
                <tr key={user.id}>
                  <td>{user.id}</td>
                  <td>{user.username}</td>
                  <td>{user.is_active ? "Yes" : "No"}</td>
                  <td>{new Date(user.updated_at).toLocaleString()}</td>
                  <td>
                    <div className="row">
                      <button className="btn" type="button" onClick={() => openEdit(user)}>
                        Sửa
                      </button>
                      <button className="btn" type="button" onClick={() => void onDelete(user)} disabled={isSelf}>
                        Xoá
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Chưa có user nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={addOpen} title="Add user" onClose={() => setAddOpen(false)}>
        <form onSubmit={onCreate} className="row" style={{ alignItems: "stretch" }}>
          <div className="field" style={{ minWidth: 240 }}>
            <label>Username</label>
            <input
              className="input"
              value={createForm.username}
              onChange={(e) => setCreateForm((s) => ({ ...s, username: e.target.value }))}
              required
            />
          </div>
          <div className="field" style={{ minWidth: 240 }}>
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm((s) => ({ ...s, password: e.target.value }))}
              required
            />
          </div>
          <label className="row" style={{ minHeight: 42 }}>
            <input
              type="checkbox"
              checked={createForm.is_active}
              onChange={(e) => setCreateForm((s) => ({ ...s, is_active: e.target.checked }))}
            />
            Active
          </label>
          <div className="row" style={{ justifyContent: "flex-end", width: "100%" }}>
            <button className="btn primary" type="submit">
              Create
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={editOpen && selected != null} title={`Edit user #${selected?.id ?? ""}`} onClose={() => setEditOpen(false)}>
        <form onSubmit={onEdit} className="row" style={{ alignItems: "stretch" }}>
          <div className="field" style={{ minWidth: 240 }}>
            <label>Username</label>
            <input
              className="input"
              value={editForm.username}
              onChange={(e) => setEditForm((s) => ({ ...s, username: e.target.value }))}
              required
            />
          </div>
          <div className="field" style={{ minWidth: 240 }}>
            <label>New password (optional)</label>
            <input
              className="input"
              type="password"
              value={editForm.password}
              onChange={(e) => setEditForm((s) => ({ ...s, password: e.target.value }))}
            />
          </div>
          <label className="row" style={{ minHeight: 42 }}>
            <input
              type="checkbox"
              checked={editForm.is_active}
              onChange={(e) => setEditForm((s) => ({ ...s, is_active: e.target.checked }))}
            />
            Active
          </label>
          <div className="row" style={{ justifyContent: "flex-end", width: "100%" }}>
            <button className="btn primary" type="submit">
              Save
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
