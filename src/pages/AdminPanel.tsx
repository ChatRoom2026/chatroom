import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { request } from '@/lib/api'
import { connectSocket } from '@/lib/socket'
import { ArrowLeft, Trash2, Shield, Search, X, RefreshCw, LogIn } from 'lucide-react'

interface AdminUser {
  id: number
  username: string
  email: string
  avatar: string
  bio: string
  gender: string
  region: string
  age: number
  active: number
  vip: number
  vipExpiresAt: string | null
  isOfficial: number
  phone: string
  createdAt: string
}

export default function AdminPanel() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null)
  const [error, setError] = useState('')
  const [impersonating, setImpersonating] = useState<number | null>(null)

  const fetchUsers = useCallback(async (p: number, s: string) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('page', String(p))
      params.set('limit', '30')
      if (s) params.set('search', s)
      const res = await request<{ success: boolean; users: AdminUser[]; total: number; page: number; totalPages: number }>('/admin/users?' + params.toString())
      setUsers(res.users)
      setTotal(res.total)
      setPage(res.page)
      setTotalPages(res.totalPages)
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.isOfficial !== 1) {
      navigate('/friends', { replace: true })
      return
    }
    fetchUsers(1, '')
  }, [user, navigate, fetchUsers])

  const handleSearch = () => {
    fetchUsers(1, search)
  }

  const handleDelete = async (target: AdminUser) => {
    setDeleting(target.id)
    try {
      await request(`/admin/users/${target.id}`, { method: 'DELETE' })
      setConfirmDelete(null)
      fetchUsers(page, search)
    } catch (err: any) {
      setError(err.message || '删除失败')
    } finally {
      setDeleting(null)
    }
  }

  const handleImpersonate = async (target: AdminUser) => {
    setImpersonating(target.id)
    try {
      const res = await request<{ success: boolean; user: any; token: string }>('/admin/impersonate', {
        method: 'POST',
        body: JSON.stringify({ targetId: target.id }),
      })
      if (res.success && res.token) {
        localStorage.setItem('token', res.token)
        localStorage.setItem('user', JSON.stringify(res.user))
        connectSocket(res.token)
        useAuthStore.setState({ user: res.user, token: res.token, isLoggedIn: true })
        navigate('/friends', { replace: true })
      }
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally {
      setImpersonating(null)
    }
  }

  if (user?.isOfficial !== 1) return null

  return (
    <div className="h-screen bg-[#0F172A] flex flex-col">
      {/* Header */}
      <div className="bg-[#1E293B] border-b border-gray-800 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/friends')}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-yellow-400" />
              <h1 className="text-white font-semibold text-lg">管理后台</h1>
            </div>
          </div>
          <button
            onClick={() => fetchUsers(page, search)}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 mt-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-9 pr-4 py-2 bg-[#0F172A] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="搜索用户名或邮箱..."
            />
          </div>
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            搜索
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="px-4 py-2 text-sm text-gray-400">
        共 {total} 个用户，第 {page}/{totalPages} 页
      </div>

      {/* User List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center text-gray-500 py-12">暂无用户</div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className="bg-[#1E293B] rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold flex-shrink-0">
                      {u.username?.[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-white font-medium text-sm truncate">{u.username}</span>
                        {u.vip === 1 && (
                          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">VIP</span>
                        )}
                        {u.isOfficial === 1 && (
                          <span className="flex items-center gap-0.5 text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">
                            <Shield className="w-3 h-3" />
                            官方
                          </span>
                        )}
                        {u.active === 0 && (
                          <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">已注销</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {u.email || '无邮箱'} · ID: {u.id}
                        {u.region && ` · ${u.region}`}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-500">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString('zh-CN') : '-'}
                    </span>
                    {u.id !== user?.id && (
                      <>
                        <button
                          onClick={() => handleImpersonate(u)}
                          disabled={impersonating === u.id}
                          className="p-2 text-gray-400 hover:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors disabled:opacity-50"
                          title="登录为该用户"
                        >
                          <LogIn className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(u)}
                          disabled={deleting === u.id}
                          className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                          title="删除用户"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="bg-[#1E293B] border-t border-gray-800 p-4 flex items-center justify-center gap-2">
          <button
            onClick={() => fetchUsers(page - 1, search)}
            disabled={page <= 1}
            className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors"
          >
            上一页
          </button>
          <span className="text-gray-400 text-sm">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => fetchUsers(page + 1, search)}
            disabled={page >= totalPages}
            className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors"
          >
            下一页
          </button>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[#1E293B] border border-gray-700 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-white font-semibold text-lg mb-2">确认删除</h3>
            <p className="text-gray-400 text-sm mb-4">
              确定要删除用户 <span className="text-white font-medium">{confirmDelete.username}</span> 吗？此操作将清除该用户的所有数据（动态、评论、消息、好友关系等），且不可恢复。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={deleting === confirmDelete.id}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {deleting === confirmDelete.id ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}