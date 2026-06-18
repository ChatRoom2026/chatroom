import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { api, setApiBaseUrl, getApiBaseUrl } from '@/lib/api'
import { isAndroid, isNativeApp, getPlatform } from '@/lib/platform'
import {
  ArrowLeft, Camera, Trash2, User, Loader2, Server, Smartphone,
  Edit2, Save, X as XIcon, Check, MapPin
} from 'lucide-react'

type Gender = '' | 'male' | 'female' | 'other'

const GENDER_OPTIONS: Array<{ value: Gender; label: string; emoji: string }> = [
  { value: '',         label: '未设置', emoji: '🔒' },
  { value: 'male',     label: '男',    emoji: '♂' },
  { value: 'female',   label: '女',    emoji: '♀' },
  { value: 'other',    label: '其他',  emoji: '⚧' },
]

export default function Settings() {
  const user = useAuthStore((s) => s.user)
  const deleteAccount = useAuthStore((s) => s.deleteAccount)
  const navigate = useNavigate()

  // 资料
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [gender, setGender] = useState<Gender>('')
  const [region, setRegion] = useState('')
  const [avatar, setAvatar] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [showAvatarModal, setShowAvatarModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [serverUrl, setServerUrl] = useState(getApiBaseUrl())
  const [savingServer, setSavingServer] = useState(false)
  const [platform, setPlatform] = useState('web')

  // 加载个人资料
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.getProfile()
        if (cancelled) return
        if (res.success) {
          setUsername(res.user.username || '')
          setBio(res.user.bio || '')
          setGender((res.user.gender as Gender) || '')
          setRegion(res.user.region || '')
          setAvatar(res.user.avatar || '')
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setPlatform(getPlatform())
  }, [])

  const handleSaveAll = async () => {
    if (!username.trim()) { setError('用户名不能为空'); return }
    if (username.length < 2 || username.length > 20) { setError('用户名长度需在2-20个字符之间'); return }
    if (bio.length > 200) { setError('简介不能超过 200 个字符'); return }
    if (region.length > 30) { setError('地区不能超过 30 个字符'); return }

    setError(''); setSuccess(''); setSaving(true)
    try {
      await api.updateProfile({ username: username.trim(), bio: bio.trim(), gender, region: region.trim() })

      // 同步更新 localStorage 和 store
      const userStr = localStorage.getItem('user')
      if (userStr) {
        try {
          const userInfo = JSON.parse(userStr)
          userInfo.username = username.trim()
          userInfo.bio = bio.trim()
          userInfo.gender = gender
          userInfo.region = region.trim()
          localStorage.setItem('user', JSON.stringify(userInfo))
          useAuthStore.setState({ user: { ...user, ...userInfo } })
        } catch {}
      }
      setSuccess('保存成功')
      setTimeout(() => setSuccess(''), 2000)
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

    setError(''); setSuccess('')
    try {
      const res = await api.uploadFile(file)
      const avatarUrl = res.url
      await api.updateAvatar(avatarUrl)
      setAvatar(avatarUrl)

      const userStr = localStorage.getItem('user')
      if (userStr) {
        try {
          const userInfo = JSON.parse(userStr)
          userInfo.avatar = avatarUrl
          localStorage.setItem('user', JSON.stringify(userInfo))
          useAuthStore.setState({ user: { ...user, avatar: avatarUrl } })
        } catch {}
      }
      setShowAvatarModal(false)
      setSuccess('头像已更新')
      setTimeout(() => setSuccess(''), 2000)
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

  const handleSaveServer = async () => {
    setSavingServer(true)
    setError(''); setSuccess('')
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

  // 计算用户名首字母（用于默认头像）
  const initial = username?.[0]?.toUpperCase() || '?'

  if (loading) {
    return (
      <div className="h-screen bg-[#0F172A] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-screen bg-[#0F172A] overflow-y-auto">
      {/* 顶部 Header */}
      <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate('/friends')}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-white font-semibold text-lg flex-1">个人资料</h1>
        <button
          onClick={handleSaveAll}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm rounded-lg transition-colors flex items-center gap-1.5"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存
        </button>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* 头像区 */}
        <div className="bg-[#1E293B] rounded-2xl p-6 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
            <User className="w-4 h-4" />
            头像
          </h2>
          <div className="flex items-center gap-5">
            <button
              onClick={() => setShowAvatarModal(true)}
              className="relative group"
            >
              {avatar ? (
                <img
                  src={avatar}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover border-4 border-gray-700"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-3xl font-semibold border-4 border-gray-700">
                  {initial}
                </div>
              )}
              <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                <Camera className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium">{username || '未设置用户名'}</p>
              <p className="text-xs text-gray-500 mt-1">点击头像更换 · 支持 JPG/PNG · 最大 5MB</p>
              <button
                onClick={() => setShowAvatarModal(true)}
                className="mt-3 px-3 py-1.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 text-xs rounded-lg transition-colors"
              >
                更换头像
              </button>
            </div>
          </div>
        </div>

        {/* 基本资料 */}
        <div className="bg-[#1E293B] rounded-2xl p-6 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
            <Edit2 className="w-4 h-4" />
            基本资料
          </h2>
          <div className="space-y-4">
            {/* 用户名 */}
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">用户名 <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="输入用户名（2-20字符）"
                maxLength={20}
              />
            </div>

            {/* 性别 */}
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">性别</label>
              <div className="grid grid-cols-4 gap-2">
                {GENDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value || 'unset'}
                    onClick={() => setGender(opt.value)}
                    className={`py-2.5 rounded-lg text-sm transition-colors border ${
                      gender === opt.value
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-[#0F172A] border-gray-700 text-gray-300 hover:border-gray-600'
                    }`}
                  >
                    <span className="mr-1">{opt.emoji}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 地区 */}
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                地区
              </label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="例如：北京 / 上海"
                maxLength={30}
              />
            </div>

            {/* 简介 */}
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block flex items-center justify-between">
                <span>个人简介</span>
                <span className="text-gray-600">{bio.length} / 200</span>
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                maxLength={200}
                className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                placeholder="写一句想对大家说的话..."
              />
            </div>
          </div>
        </div>

        {/* 提示信息 */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3 flex items-center gap-2">
            <XIcon className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg p-3 flex items-center gap-2">
            <Check className="w-4 h-4 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* Android 服务器配置 */}
        {showServerConfig && (
          <div className="bg-[#1E293B] rounded-2xl p-6 border border-gray-800">
            <h2 className="text-sm font-semibold text-green-400 mb-4 flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              Android 原生客户端
            </h2>
            <p className="text-xs text-gray-500 mb-4">当前平台：{platform} · 应用版本 1.0</p>

            <label className="text-xs text-gray-400 mb-1.5 block">
              <Server className="w-3.5 h-3.5 inline mr-1" />
              服务器地址
            </label>
            <div className="flex gap-2 mb-2">
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
            <p className="text-xs text-gray-500 leading-relaxed">
              输入运行 ChatRoom 后端的服务器地址（含 <code className="text-blue-400">/api</code> 后缀）。
              模拟器使用 <code className="text-blue-400">http://10.0.2.2:3001/api</code>，
              真机使用电脑的局域网 IP，如 <code className="text-blue-400">http://192.168.1.100:3001/api</code>。
            </p>
          </div>
        )}

        {/* 危险区域 */}
        <div className="bg-[#1E293B] rounded-2xl p-6 border border-red-500/20">
          <h2 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            危险操作
          </h2>
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

      {/* 头像上传模态框 */}
      {showAvatarModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowAvatarModal(false)}>
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">更换头像</h3>
            <div className="flex justify-center mb-6">
              {avatar ? (
                <img src={avatar} alt="" className="w-28 h-28 rounded-full object-cover border-4 border-gray-700" />
              ) : (
                <div className="w-28 h-28 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-4xl font-semibold border-4 border-gray-700">
                  {initial}
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

      {/* 注销确认 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !deleting && setShowDeleteConfirm(false)}>
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
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
              确定要注销账号 <span className="text-white font-semibold">{username}</span> 吗？注销后：
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
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                {deleting ? '注销中...' : '确认注销'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
