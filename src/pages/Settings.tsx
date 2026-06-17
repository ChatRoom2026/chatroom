import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { api, setApiBaseUrl, getApiBaseUrl } from '@/lib/api'
import { isAndroid, isNativeApp, getPlatform } from '@/lib/platform'
import { Settings as SettingsIcon, ArrowLeft, Camera, Trash2, User, Loader2, Server, Smartphone } from 'lucide-react'

export default function Settings() {
  const user = useAuthStore((s) => s.user)
  const deleteAccount = useAuthStore((s) => s.deleteAccount)
  const navigate = useNavigate()

  const [username, setUsername] = useState(user?.username || '')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAvatarModal, setShowAvatarModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl())
  const [savingServer, setSavingServer] = useState(false)
  const [platform, setPlatform] = useState('web')

  const updateUserInfo = useCallback(() => {
    const userStr = localStorage.getItem('user')
    if (userStr) {
      try { return JSON.parse(userStr) } catch {}
    }
    return user
  }, [user])

  const currentUser = updateUserInfo()
  const userAvatar = currentUser?.avatar || ''

  const handleSaveUsername = async () => {
    if (!username.trim()) {
      setError('用户名不能为空')
      return
    }
    if (username.length < 2 || username.length > 20) {
      setError('用户名长度需在2-20个字符之间')
      return
    }
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      const res = await api.updateProfile(username)
      // 更新 localStorage 和 store
      const userInfo = updateUserInfo()
      userInfo.username = res.username
      localStorage.setItem('user', JSON.stringify(userInfo))
      useAuthStore.setState({ user: userInfo })
      setSuccess('用户名已更新')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('请选择图片文件'); return }
    if (file.size > 5 * 1024 * 1024) { setError('图片大小不能超过5MB'); return }

    setError('')
    setSuccess('')
    try {
      const res = await api.uploadFile(file)
      const avatarUrl = res.url
      await api.updateAvatar(avatarUrl)
      const userInfo = updateUserInfo()
      userInfo.avatar = avatarUrl
      localStorage.setItem('user', JSON.stringify(userInfo))
      useAuthStore.setState({ user: { ...user, avatar: avatarUrl } })
      setShowAvatarModal(false)
      setSuccess('头像已更新')
    } catch (err: any) { setError(err.message) }
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      await deleteAccount()
      navigate('/')
    } catch (err: any) {
      setError(err.message)
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  useEffect(() => {
    setPlatform(getPlatform())
  }, [])

  const handleSaveServer = async () => {
    setSavingServer(true)
    setError('')
    setSuccess('')
    try {
      setApiBaseUrl(serverUrl.trim())
      setSuccess('服务器地址已保存，重启 App 生效')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSavingServer(false)
    }
  }

  const showServerConfig = isNativeApp() && isAndroid()

  return (
    <div className="min-h-screen bg-[#0F172A] flex">
      {/* Sidebar */}
      <div className="w-80 bg-[#1E293B] flex flex-col border-r border-gray-800">
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => navigate('/friends')}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-white font-semibold text-lg">设置</h2>
          </div>
        </div>

        <div className="flex-1 p-4">
          <div className="space-y-6">
            {/* Avatar section */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">头像</label>
              <div className="flex items-center gap-4">
                <div className="relative">
                  {userAvatar ? (
                    <img src={userAvatar} alt="" className="w-20 h-20 rounded-full object-cover border-4 border-gray-700" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-semibold border-4 border-gray-700">
                      {user?.username?.[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowAvatarModal(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                >
                  更换头像
                </button>
              </div>
            </div>

            {/* Username section */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">用户名</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="flex-1 px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="输入新用户名"
                  maxLength={20}
                />
                <button
                  onClick={handleSaveUsername}
                  disabled={saving}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>

            {/* Error / Success messages */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3">{error}</div>
            )}
            {success && (
              <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg p-3">{success}</div>
            )}

            {/* Platform info (Android) */}
            {showServerConfig && (
              <div className="border-t border-gray-800 pt-6">
                <div className="flex items-center gap-2 mb-3">
                  <Smartphone className="w-4 h-4 text-green-400" />
                  <h3 className="text-sm font-semibold text-green-400">Android 原生客户端</h3>
                </div>
                <p className="text-xs text-gray-500 mb-4">当前平台：{platform} · 应用版本 1.0</p>

                <label className="text-sm text-gray-400 mb-2 block">
                  <Server className="w-3.5 h-3.5 inline mr-1" />
                  服务器地址
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    className="flex-1 px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                    placeholder="http://192.168.1.100:3000/api"
                  />
                  <button
                    onClick={handleSaveServer}
                    disabled={savingServer}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors whitespace-nowrap text-sm"
                  >
                    {savingServer ? '保存中' : '保存'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                  输入运行 ChatRoom 后端的服务器地址（包含 <code className="text-blue-400">/api</code> 后缀）。
                  模拟器使用 <code className="text-blue-400">http://10.0.2.2:3001/api</code>，
                  真机请使用电脑的局域网 IP，例如 <code className="text-blue-400">http://192.168.1.100:3001/api</code>。
                </p>
              </div>
            )}

            {/* Danger zone */}
            <div className="border-t border-gray-800 pt-6">
              <h3 className="text-sm font-semibold text-red-400 mb-3">危险操作</h3>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-red-400 rounded-lg transition-colors text-sm"
              >
                <Trash2 className="w-4 h-4" />
                注销账号
              </button>
              <p className="text-xs text-gray-500 mt-2">注销后好友关系将被清除，用户名可被他人重新注册</p>
            </div>
          </div>
        </div>
      </div>

      {/* Welcome area */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-500/10 mb-4">
            <SettingsIcon className="w-10 h-10 text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">设置</h2>
          <p className="text-gray-400">修改你的个人资料</p>
        </div>
      </div>

      {/* Avatar upload modal */}
      {showAvatarModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-semibold text-white mb-4">更换头像</h3>
            <div className="flex justify-center mb-6">
              {userAvatar ? (
                <img src={userAvatar} alt="" className="w-24 h-24 rounded-full object-cover border-4 border-gray-700" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-blue-600 flex items-center justify-center text-white text-3xl font-semibold border-4 border-gray-700">
                  {user?.username?.[0]?.toUpperCase()}
                </div>
              )}
            </div>
            <label className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer transition-colors">
              <Camera className="w-5 h-5" />
              选择图片
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            </label>
            <button
              onClick={() => setShowAvatarModal(false)}
              className="w-full mt-3 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">注销账号</h3>
                <p className="text-sm text-gray-400">此操作不可撤销</p>
              </div>
            </div>
            <p className="text-gray-300 text-sm mb-4">
              确定要注销账号 <span className="text-white font-semibold">{user?.username}</span> 吗？注销后：
            </p>
            <ul className="text-sm text-gray-400 mb-6 space-y-1.5 list-disc list-inside">
              <li>所有好友关系将被清除</li>
              <li>聊天记录将被保留</li>
              <li>用户名可被他人重新注册</li>
            </ul>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors"
              >
                {deleting ? '注销中...' : '确认注销'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}