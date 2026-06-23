import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { api, setApiBaseUrl, getApiBaseUrl, resolveStaticUrl } from '@/lib/api'
import { isAndroid, isNativeApp, getPlatform } from '@/lib/platform'
import {
  ArrowLeft, Camera, Trash2, User, Loader2, Server, Smartphone,
  Edit2, Save, X as XIcon, Check, MapPin, Key, ScanFace, Navigation
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

  // 定位相关
  const [locating, setLocating] = useState(false)
  const [locLoadingByIp, setLocLoadingByIp] = useState(false)
  const [locMessage, setLocMessage] = useState('')

  // 修改密码相关
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [pwdError, setPwdError] = useState('')
  const [pwdSuccess, setPwdSuccess] = useState('')

  // 人脸注册相关
  const [faceModal, setFaceModal] = useState(false)
  const [faceCameraReady, setFaceCameraReady] = useState(false)
  const [faceLoading, setFaceLoading] = useState(false)
  const [faceError, setFaceError] = useState('')
  const [faceSuccess, setFaceSuccess] = useState('')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

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

  // ========== 自动定位：先尝试 navigator.geolocation，失败则用 IP 归属地 ==========
  async function handleAutoLocate() {
    setLocMessage('')

    // 优先：浏览器地理定位（手机 GPS / 浏览器定位）
    if (navigator.geolocation) {
      setLocating(true)
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const res = await api.updateLocation({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              location: `经纬度 ${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`,
            })
            setRegion(res.region || '已定位')
            setLocMessage('✓ 已通过浏览器定位')
          } catch (err: any) {
            setLocMessage(`⚠ 浏览器定位失败：${err.message || '未知错误'}`)
            // fallback 到 IP 归属地
            await fetchIpLocation()
          } finally {
            setLocating(false)
          }
        },
        async (geoErr) => {
          setLocating(false)
          setLocMessage(`⚠ 定位被拒绝：${geoErr?.message || '请在浏览器中允许定位'}`)
          await fetchIpLocation()
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      )
    } else {
      await fetchIpLocation()
    }
  }

  async function fetchIpLocation() {
    setLocLoadingByIp(true)
    try {
      const res = await api.getLocationByIp()
      if (res.success) {
        setRegion(res.location || '')
        setLocMessage(res.isPrivate ? `⚠ 当前 IP ${res.ip} 为内网环境，无法自动定位，请手动输入地区` : `✓ 已通过 IP 归属地定位：${res.location}`)
      } else {
        setLocMessage('⚠ IP 归属地查询失败，请手动输入地区')
      }
    } catch (err: any) {
      setLocMessage(`⚠ IP 归属地查询失败：${err.message || '网络异常'}`)
    } finally {
      setLocLoadingByIp(false)
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

  // ========== 修改密码 ==========
  const handleChangePassword = async () => {
    setPwdError(''); setPwdSuccess('')
    if (!oldPassword || !newPassword || !confirmPassword) { setPwdError('请填写完整的旧密码和新密码'); return }
    if (newPassword.length < 6) { setPwdError('新密码长度不能少于 6 位'); return }
    if (newPassword !== confirmPassword) { setPwdError('两次输入的新密码不一致'); return }
    if (newPassword === oldPassword) { setPwdError('新密码不能与旧密码相同'); return }
    setPwdLoading(true)
    try {
      await api.changePassword(oldPassword, newPassword)
      setPwdSuccess('密码修改成功，下次登录请使用新密码')
      setOldPassword(''); setNewPassword(''); setConfirmPassword('')
      setTimeout(() => setPwdSuccess(''), 3000)
    } catch (err: any) {
      setPwdError(err.message)
    } finally {
      setPwdLoading(false)
    }
  }

  // ========== 人脸注册 ==========
  function openFaceModal() {
    setFaceError(''); setFaceSuccess(''); setFaceModal(true)
  }
  function closeFaceModal() {
    setFaceModal(false)
    setFaceCameraReady(false)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }
  async function startFaceCamera() {
    setFaceError(''); setFaceSuccess('')
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setFaceError('当前浏览器不支持摄像头访问')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
        setFaceCameraReady(true)
      }
    } catch (err: any) {
      setFaceError(err?.message || '无法打开摄像头，请检查权限')
    }
  }
  function extractDescriptorFromCanvas(canvas: HTMLCanvasElement): number[] {
    const ctx = canvas.getContext('2d'); if (!ctx) return []
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = img.data
    const sx = Math.floor(canvas.width * 0.2)
    const sy = Math.floor(canvas.height * 0.2)
    const sw = canvas.width - 2 * sx
    const sh = canvas.height - 2 * sy
    const blockW = Math.max(1, Math.floor(sw / 8))
    const blockH = Math.max(1, Math.floor(sh / 8))
    const feats: number[] = []
    for (let by = 0; by < 8; by++) {
      for (let bx = 0; bx < 8; bx++) {
        let sum = 0; let count = 0
        for (let y = by * blockH; y < (by + 1) * blockH; y++) {
          for (let x = bx * blockW; x < (bx + 1) * blockW; x++) {
            const idx = ((sy + y) * canvas.width + (sx + x)) * 4
            sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
            count++
          }
        }
        feats.push(count ? sum / count / 255 : 0)
      }
    }
    let norm = 0
    for (let i = 0; i < feats.length; i++) norm += feats[i] * feats[i]
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < feats.length; i++) feats[i] = Math.round((feats[i] / norm) * 10000) / 10000
    return feats
  }
  async function handleRegisterFace() {
    if (!videoRef.current || !canvasRef.current || !faceCameraReady) {
      setFaceError('摄像头未就绪，请稍等')
      return
    }
    setFaceLoading(true)
    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      canvas.width = 128; canvas.height = 128
      const ctx = canvas.getContext('2d'); if (!ctx) return
      ctx.translate(canvas.width, 0); ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const descriptor = extractDescriptorFromCanvas(canvas)
      if (descriptor.length < 4) { setFaceError('未能采集人脸特征，请调整光线重试'); return }
      await api.registerFace(descriptor)
      setFaceSuccess('人脸特征已注册成功！下次可直接使用人脸登录')
    } catch (err: any) {
      setFaceError(err.message || '注册失败')
    } finally {
      setFaceLoading(false)
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
                  src={resolveStaticUrl(avatar)}
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
              <div className="flex gap-2">
                <input
                  type="text"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="flex-1 px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="例如：北京 / 上海"
                  maxLength={30}
                />
                <button
                  type="button"
                  onClick={handleAutoLocate}
                  disabled={locating || locLoadingByIp}
                  title="自动定位"
                  className="px-3 py-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1 text-xs disabled:opacity-50"
                >
                  {(locating || locLoadingByIp) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <Navigation className="w-4 h-4" />
                  自动定位
                </button>
              </div>
              {locMessage && (
                <p className={`text-xs mt-1 ${locMessage.startsWith('✓') ? 'text-emerald-400' : 'text-yellow-400'}`}>{locMessage}</p>
              )}
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

        {/* 修改密码 */}
        <div className="bg-[#1E293B] rounded-2xl p-6 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
            <Key className="w-4 h-4" />
            修改登录密码
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">当前密码</label>
              <input
                type={showNewPwd ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="请输入当前密码"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">新密码（至少 6 位）</label>
              <input
                type={showNewPwd ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="请输入新密码"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">确认新密码</label>
              <input
                type={showNewPwd ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="请再次输入新密码"
                onKeyDown={(e) => { if (e.key === 'Enter') handleChangePassword() }}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showNewPwd}
                  onChange={(e) => setShowNewPwd(e.target.checked)}
                  className="w-3.5 h-3.5 accent-blue-500"
                />
                显示密码
              </label>
              <button
                onClick={handleChangePassword}
                disabled={pwdLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
              >
                {pwdLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {pwdLoading ? '提交中...' : '确认修改'}
              </button>
            </div>
            {pwdError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg p-2.5 flex items-center gap-2">
                <XIcon className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{pwdError}</span>
              </div>
            )}
            {pwdSuccess && (
              <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-xs rounded-lg p-2.5 flex items-center gap-2">
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{pwdSuccess}</span>
              </div>
            )}
          </div>
        </div>

        {/* 人脸识别登录 */}
        <div className="bg-[#1E293B] rounded-2xl p-6 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
            <ScanFace className="w-4 h-4" />
            人脸识别登录
          </h2>
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            注册人脸特征后，登录页面可直接通过摄像头人脸识别登录，无需输入密码。
            所有图像处理均在您的设备上完成，仅上传特征向量。
          </p>
          <button
            onClick={openFaceModal}
            className="w-full px-4 py-2.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
          >
            <ScanFace className="w-4 h-4" />
            {user?.faceDescriptor ? '更新人脸特征' : '注册人脸特征'}
          </button>
          {user?.faceDescriptor && (
            <p className="text-xs text-emerald-400 mt-2.5 flex items-center gap-1">
              <Check className="w-3 h-3" />
              已注册人脸特征
            </p>
          )}
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
                <img src={resolveStaticUrl(avatar)} alt="" className="w-28 h-28 rounded-full object-cover border-4 border-gray-700" />
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

      {/* 人脸注册模态框 */}
      {faceModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={closeFaceModal}>
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <ScanFace className="w-5 h-5 text-purple-300" />
              注册人脸特征
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              请正对着摄像头，保持光线充足，点击"采集并注册"按钮完成。
            </p>
            <div className="relative bg-black rounded-xl overflow-hidden aspect-video mb-3">
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
              {!faceCameraReady && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
                  摄像头未启动
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>
            {faceError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg p-2 mb-3">
                {faceError}
              </div>
            )}
            {faceSuccess && (
              <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-xs rounded-lg p-2 mb-3">
                {faceSuccess}
              </div>
            )}
            <div className="flex gap-2">
              {!faceCameraReady && (
                <button
                  onClick={startFaceCamera}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
                >
                  启动摄像头
                </button>
              )}
              {faceCameraReady && (
                <button
                  onClick={handleRegisterFace}
                  disabled={faceLoading}
                  className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {faceLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {faceLoading ? '采集中...' : '采集并注册'}
                </button>
              )}
              <button
                onClick={closeFaceModal}
                disabled={faceLoading}
                className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
