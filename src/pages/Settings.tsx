import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { api, setApiBaseUrl, getApiBaseUrl, resolveStaticUrl } from '@/lib/api'
import { isAndroid, isNativeApp, getPlatform } from '@/lib/platform'
import { captureFaceDescriptor } from '@/lib/face'
import { getModelStatus, onModelStatusChange, type ModelStatus } from '@/lib/face'
import SafeImg from '@/components/SafeImg'
import {
  ArrowLeft, Camera, Trash2, User, Loader2, Server, Smartphone,
  Edit2, Save, X as XIcon, Check, MapPin, Key, ScanFace, Navigation, AlertCircle
} from 'lucide-react'

type Gender = '' | 'male' | 'female' | 'other'

const GENDER_OPTIONS: Array<{ value: Gender; label: string; emoji: string }> = [
  { value: '',         label: '未设置', emoji: '🔒' },
  { value: 'male',     label: '男',    emoji: '♂' },
  { value: 'female',   label: '女',    emoji: '♀' },
  { value: 'other',    label: '其他',  emoji: '⚧' },
]

// 通用弹窗组件
function ToastModal({ type, title, message, onClose }: { type: 'error' | 'success'; title: string; message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${type === 'error' ? 'bg-red-500/10' : 'bg-green-500/10'}`}>
            {type === 'error' ? (
              <AlertCircle className="w-6 h-6 text-red-400" />
            ) : (
              <Check className="w-6 h-6 text-green-400" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <p className="text-sm text-gray-400">{type === 'error' ? '操作失败' : '操作成功'}</p>
          </div>
        </div>
        <p className="text-gray-300 text-sm mb-5 leading-relaxed">{message}</p>
        <button
          onClick={onClose}
          className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${type === 'error' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
        >
          知道了
        </button>
      </div>
    </div>
  )
}

export default function Settings() {
  const user = useAuthStore((s) => s.user)
  const deleteAccount = useAuthStore((s) => s.deleteAccount)
  const navigate = useNavigate()

  // 弹窗状态
  const [toast, setToast] = useState<{ type: 'error' | 'success'; title: string; message: string } | null>(null)

  // 资料
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [gender, setGender] = useState<Gender>('')
  const [region, setRegion] = useState('')
  const [age, setAge] = useState('')
  const [avatar, setAvatar] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [showAvatarModal, setShowAvatarModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 定位相关
  const [locLoadingByIp, setLocLoadingByIp] = useState(false)
  const [locMessage, setLocMessage] = useState('')
  const [regionLocked, setRegionLocked] = useState(false) // 自动定位后锁定
  const [locLoadingByGps, setLocLoadingByGps] = useState(false)

  // 修改密码相关
  const [verifyMethod, setVerifyMethod] = useState<'old_password' | 'email_code' | 'face'>('old_password')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [pwdError, setPwdError] = useState('')
  const [pwdSuccess, setPwdSuccess] = useState('')

  // 邮箱验证码相关
  const [verifyEmail, setVerifyEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [codeCountdown, setCodeCountdown] = useState(0)
  const [sendingCode, setSendingCode] = useState(false)

  // 人脸验证密码模态框
  const [pwdFaceModal, setPwdFaceModal] = useState(false)
  const [pwdFaceReady, setPwdFaceReady] = useState(false)
  const [pwdFaceLoading, setPwdFaceLoading] = useState(false)
  const pwdVideoRef = useRef<HTMLVideoElement | null>(null)
  const pwdCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const pwdStreamRef = useRef<MediaStream | null>(null)

  // 人脸注册相关
  const [faceModal, setFaceModal] = useState(false)
  const [modelStatus, setModelStatus] = useState<ModelStatus>(getModelStatus())
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
          const savedRegion = res.user.region || ''
          setRegion(savedRegion)
          setAge(res.user.age ? String(res.user.age) : '')
          setAvatar(res.user.avatar || '')
          // 如果用户没有设置地区，自动定位
          if (!savedRegion) {
            await autoLocate()
          } else {
            setRegionLocked(true)
          }
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

  // 监听人脸模型加载状态
  useEffect(() => {
    setModelStatus(getModelStatus())
    return onModelStatusChange(setModelStatus)
  }, [])

  const handleSaveAll = async () => {
    if (!username.trim()) { setToast({ type: 'error', title: '验证失败', message: '用户名不能为空' }); return }
    if (username.length < 2 || username.length > 20) { setToast({ type: 'error', title: '验证失败', message: '用户名长度需在2-20个字符之间' }); return }
    if (bio.length > 200) { setToast({ type: 'error', title: '验证失败', message: '简介不能超过 200 个字符' }); return }
    if (region.length > 30) { setToast({ type: 'error', title: '验证失败', message: '地区不能超过 30 个字符' }); return }
    const ageNum = age ? parseInt(age) : 0
    if (age && (isNaN(ageNum) || ageNum < 1 || ageNum > 150)) { setToast({ type: 'error', title: '验证失败', message: '请输入有效的年龄（1-150）' }); return }

    setError(''); setSuccess(''); setSaving(true)
    try {
      await api.updateProfile({ username: username.trim(), bio: bio.trim(), gender, region: region.trim(), age: ageNum })

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
      setToast({ type: 'success', title: '保存成功', message: '个人资料已更新' })
    } catch (err: any) {
      setToast({ type: 'error', title: '保存失败', message: err.message || '未知错误' })
    } finally {
      setSaving(false)
    }
  }

  // ========== 自动定位：IP 归属地 + 浏览器 GPS 双重定位 ==========
  async function autoLocate() {
    setLocMessage('')
    setLocLoadingByIp(true)
    try {
      const res = await api.getLocationByIp()
      if (res.success) {
        const loc = res.location || ''
        if (loc && !res.isPrivate) {
          setRegion(loc)
          setRegionLocked(true)
          setLocMessage(`✓ 已自动定位：${loc}`)
          // 同时尝试浏览器 GPS 精确定位（静默，不阻塞）
          tryGpsLocate()
          return
        }
      }
      // IP 定位失败，尝试 GPS
      setLocMessage('⚠ IP 定位失败，正在尝试 GPS 定位...')
      await tryGpsLocate()
      if (!locMessage) {
        setLocMessage('⚠ 无法自动定位，请手动输入地区')
      }
    } catch (err: any) {
      setLocMessage(`⚠ 定位失败：${err.message || '网络异常'}`)
    } finally {
      setLocLoadingByIp(false)
    }
  }

  async function tryGpsLocate() {
    if (!navigator.geolocation) return
    setLocLoadingByGps(true)
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 0,
        })
      })
      const { latitude, longitude } = pos.coords
      // 使用 Nominatim 反向地理编码（免费，无需 key）
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=12&accept-language=zh`,
        { headers: { 'User-Agent': 'ChatRoom/1.0' } }
      )
      const data = await resp.json()
      if (data?.address) {
        const addr = data.address
        // 优先取区县/乡镇级别，如 "宁乡"、"桂东"
        const district = addr.county || addr.town || addr.village || addr.city_district || ''
        const city = addr.city || addr.state_district || ''
        const province = addr.state || addr.province || ''
        const parts: string[] = []
        if (province) parts.push(province.replace(/省|市|自治区|特别行政区/g, ''))
        if (city && city !== province && !city.includes(province.replace(/省|市|自治区|特别行政区/g, ''))) parts.push(city)
        if (district && district !== city) parts.push(district)
        if (parts.length >= 2) {
          const gpsLoc = parts.join(' · ')
          setRegion(gpsLoc)
          setRegionLocked(true)
          setLocMessage(`✓ GPS 精确定位：${gpsLoc}`)
        }
      }
    } catch {
      // GPS 定位失败，静默
    } finally {
      setLocLoadingByGps(false)
    }
  }

  function handleAutoLocate() {
    setRegionLocked(false)
    autoLocate()
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setToast({ type: 'error', title: '格式错误', message: '请选择图片文件' }); return }
    if (file.size > 5 * 1024 * 1024) { setToast({ type: 'error', title: '文件过大', message: '图片大小不能超过5MB' }); return }

    setError(''); setSuccess('')
    try {
      const res = await api.uploadFile(file)
      const avatarUrl = res.url
      await api.updateAvatar(avatarUrl)
      setAvatar(avatarUrl + '?t=' + Date.now())

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
      setToast({ type: 'success', title: '头像已更新', message: '头像更换成功！' })
    } catch (err: any) { setToast({ type: 'error', title: '上传失败', message: err.message || '未知错误' }) }
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      await deleteAccount()
      navigate('/')
    } catch (err: any) {
      setToast({ type: 'error', title: '注销失败', message: err.message || '未知错误' })
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  // ========== 验证码倒计时 ==========
  useEffect(() => {
    if (codeCountdown <= 0) return
    const timer = setTimeout(() => setCodeCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [codeCountdown])

  // ========== 发送邮箱验证码 ==========
  const handleSendCode = async () => {
    if (!verifyEmail || !verifyEmail.includes('@')) {
      setToast({ type: 'error', title: '验证失败', message: '请输入有效的邮箱地址' })
      return
    }
    setSendingCode(true)
    setPwdError('')
    try {
      await api.sendPasswordResetCode(verifyEmail)
      setCodeCountdown(60)
    } catch (err: any) {
      setToast({ type: 'error', title: '发送失败', message: err.message || '未知错误' })
    } finally {
      setSendingCode(false)
    }
  }

  // ========== 人脸验证密码相关 ==========
  function openPwdFaceModal() {
    setPwdError(''); setPwdSuccess(''); setPwdFaceModal(true)
  }
  function closePwdFaceModal() {
    setPwdFaceModal(false)
    setPwdFaceReady(false)
    if (pwdStreamRef.current) {
      pwdStreamRef.current.getTracks().forEach((t) => t.stop())
      pwdStreamRef.current = null
    }
  }
  async function startPwdFaceCamera() {
    setPwdError('')
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPwdError('当前浏览器不支持摄像头访问')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false })
      pwdStreamRef.current = stream
      if (pwdVideoRef.current) {
        pwdVideoRef.current.srcObject = stream
        await pwdVideoRef.current.play().catch(() => {})
        setPwdFaceReady(true)
      }
    } catch (err: any) {
      setPwdError(err?.message || '无法打开摄像头，请检查权限')
    }
  }
  async function handleVerifyFaceForPassword() {
    if (!pwdVideoRef.current || !pwdCanvasRef.current || !pwdFaceReady) {
      setPwdError('摄像头未就绪，请稍等')
      return
    }
    setPwdFaceLoading(true)
    setPwdError('')
    try {
      const { descriptor } = await captureFaceDescriptor(pwdVideoRef.current, pwdCanvasRef.current)
      if (descriptor.length < 4) { setPwdError('未能采集人脸特征，请调整光线重试'); return }
      await handleChangePasswordWithFace(descriptor)
      closePwdFaceModal()
    } catch (err: any) {
      setPwdError(err.message)
    } finally {
      setPwdFaceLoading(false)
    }
  }

  // ========== 修改密码（支持三种验证方式）==========
  const handleChangePassword = async () => {
    setPwdError(''); setPwdSuccess('')

    if (newPassword.length < 6) { setToast({ type: 'error', title: '验证失败', message: '新密码长度不能少于 6 位' }); return }
    if (newPassword !== confirmPassword) { setToast({ type: 'error', title: '验证失败', message: '两次输入的新密码不一致' }); return }

    if (verifyMethod === 'old_password') {
      if (!oldPassword) { setToast({ type: 'error', title: '验证失败', message: '请输入旧密码' }); return }
      if (newPassword === oldPassword) { setToast({ type: 'error', title: '验证失败', message: '新密码不能与旧密码相同' }); return }
      setPwdLoading(true)
      try {
        await api.changePasswordWithVerification({
          verifyMethod: 'old_password',
          oldPassword,
          newPassword,
        })
        setToast({ type: 'success', title: '密码修改成功', message: '密码已修改，下次登录请使用新密码' })
        setOldPassword(''); setNewPassword(''); setConfirmPassword('')
      } catch (err: any) {
        setToast({ type: 'error', title: '修改失败', message: err.message || '未知错误' })
      } finally {
        setPwdLoading(false)
      }
    } else if (verifyMethod === 'email_code') {
      if (!verifyEmail || !verifyEmail.includes('@')) { setToast({ type: 'error', title: '验证失败', message: '请输入完整的邮箱地址' }); return }
      if (!emailCode || emailCode.length !== 6) { setToast({ type: 'error', title: '验证失败', message: '请输入6位邮箱验证码' }); return }
      setPwdLoading(true)
      try {
        await api.changePasswordWithVerification({
          verifyMethod: 'email_code',
          email: verifyEmail,
          code: emailCode,
          newPassword,
        })
        setToast({ type: 'success', title: '密码修改成功', message: '密码已修改，下次登录请使用新密码' })
        setVerifyEmail(''); setEmailCode(''); setNewPassword(''); setConfirmPassword(''); setCodeCountdown(0)
      } catch (err: any) {
        setToast({ type: 'error', title: '修改失败', message: err.message || '未知错误' })
      } finally {
        setPwdLoading(false)
      }
    } else if (verifyMethod === 'face') {
      openPwdFaceModal()
    }
  }

  const handleChangePasswordWithFace = async (descriptor: number[]) => {
    await api.changePasswordWithVerification({
      verifyMethod: 'face',
      faceDescriptor: descriptor,
      newPassword,
    })
    setToast({ type: 'success', title: '密码修改成功', message: '密码已修改，下次登录请使用新密码' })
    setNewPassword(''); setConfirmPassword('')
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
  async function handleRegisterFace() {
    if (!videoRef.current || !canvasRef.current || !faceCameraReady) {
      setFaceError('摄像头未就绪，请稍等')
      return
    }
    setFaceLoading(true)
    try {
      const { descriptor, precise } = await captureFaceDescriptor(videoRef.current, canvasRef.current)
      if (descriptor.length < 4) { setFaceError('未能采集人脸特征，请调整光线重试'); return }
      await api.registerFace(descriptor)
      const mode = precise ? '（精准模式）' : ''
      setFaceSuccess(`人脸特征已注册成功${mode}！下次可直接使用人脸登录`)
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
              <div className="w-20 h-20 rounded-full overflow-hidden">
                <SafeImg
                  src={resolveStaticUrl(avatar)}
                  fallback={
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-3xl font-semibold border-4 border-gray-700">
                      {initial}
                    </div>
                  }
                  className="w-20 h-20 object-cover border-4 border-gray-700"
                />
              </div>
              <div className="absolute inset-0 rounded-full overflow-hidden bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
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

            {/* 年龄 */}
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">年龄</label>
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="输入年龄"
                min={1}
                max={150}
              />
            </div>

            {/* 地区 */}
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                地区
                {regionLocked && <span className="text-emerald-400 text-[10px]">(自动定位)</span>}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className={`flex-1 px-4 py-2.5 bg-[#0F172A] border rounded-lg text-white placeholder-gray-500 focus:outline-none transition-colors ${
                    regionLocked ? 'border-emerald-500/30 text-emerald-300 cursor-default' : 'border-gray-700 focus:border-blue-500'
                  }`}
                  placeholder={regionLocked ? '' : '例如：北京 / 上海'}
                  maxLength={30}
                  readOnly={regionLocked}
                />
                {regionLocked ? (
                  <button
                    type="button"
                    onClick={() => setRegionLocked(false)}
                    title="手动修改"
                    className="px-3 py-2.5 bg-yellow-600/20 hover:bg-yellow-600/30 border border-yellow-500/30 text-yellow-300 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1 text-xs"
                  >
                    <Edit2 className="w-4 h-4" />
                    修改
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleAutoLocate}
                    disabled={locLoadingByIp}
                    title="自动定位"
                    className="px-3 py-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1 text-xs disabled:opacity-50"
                  >
                    {locLoadingByIp && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <Navigation className="w-4 h-4" />
                    重新定位
                  </button>
                )}
              </div>
              {locMessage && (
                <p className={`text-xs mt-1 ${locMessage.startsWith('✓') ? 'text-emerald-400' : locMessage.startsWith('⚠') ? 'text-yellow-400' : 'text-yellow-400'}`}>{locMessage}</p>
              )}
              {locLoadingByGps && (
                <p className="text-xs text-blue-400 mt-1 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  正在获取 GPS 精确定位...
                </p>
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
            {/* 验证方式选择 */}
            <div>
              <label className="text-xs text-gray-400 mb-2 block">选择验证方式</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => { setVerifyMethod('old_password'); setPwdError(''); setPwdSuccess('') }}
                  className={`py-2 rounded-lg text-xs font-medium transition-colors border ${
                    verifyMethod === 'old_password'
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-[#0F172A] border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  旧密码
                </button>
                <button
                  type="button"
                  onClick={() => { setVerifyMethod('email_code'); setPwdError(''); setPwdSuccess('') }}
                  className={`py-2 rounded-lg text-xs font-medium transition-colors border ${
                    verifyMethod === 'email_code'
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-[#0F172A] border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  邮箱验证码
                </button>
                <button
                  type="button"
                  onClick={() => { setVerifyMethod('face'); setPwdError(''); setPwdSuccess('') }}
                  className={`py-2 rounded-lg text-xs font-medium transition-colors border ${
                    verifyMethod === 'face'
                      ? 'bg-purple-600 border-purple-500 text-white'
                      : 'bg-[#0F172A] border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  人脸识别
                </button>
              </div>
            </div>

            {/* 旧密码验证 */}
            {verifyMethod === 'old_password' && (
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
            )}

            {/* 邮箱验证码验证 */}
            {verifyMethod === 'email_code' && (
              <>
                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">邮箱地址</label>
                  <input
                    type="email"
                    value={verifyEmail}
                    onChange={(e) => setVerifyEmail(e.target.value)}
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="请输入完整邮箱地址"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">验证码</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="flex-1 px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors tracking-widest"
                      placeholder="6位验证码"
                      maxLength={6}
                    />
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={sendingCode || codeCountdown > 0}
                      className="px-3 py-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-500/30 text-emerald-300 rounded-lg transition-colors whitespace-nowrap text-xs"
                    >
                      {sendingCode ? <Loader2 className="w-4 h-4 animate-spin" /> : codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* 人脸验证提示 */}
            {verifyMethod === 'face' && (
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 text-xs text-purple-300">
                <div className="flex items-start gap-2">
                  <ScanFace className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium mb-1">人脸识别验证</p>
                    <p className="text-purple-400/70">点击"确认修改"后将打开摄像头进行人脸验证。请确保您已在下方注册人脸特征。</p>
                  </div>
                </div>
              </div>
            )}

            {/* 新密码（所有方式都需要） */}
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">新密码（至少 6 位）</label>
              <input
                type={showNewPwd ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none transition-colors ${
                  verifyMethod === 'email_code' ? 'focus:border-emerald-500' :
                  verifyMethod === 'face' ? 'focus:border-purple-500' : 'focus:border-blue-500'
                }`}
                placeholder="请输入新密码"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1.5 block">确认新密码</label>
              <input
                type={showNewPwd ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none transition-colors ${
                  verifyMethod === 'email_code' ? 'focus:border-emerald-500' :
                  verifyMethod === 'face' ? 'focus:border-purple-500' : 'focus:border-blue-500'
                }`}
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
                className={`px-4 py-2 disabled:opacity-50 text-white rounded-lg text-sm transition-colors flex items-center gap-2 ${
                  verifyMethod === 'email_code' ? 'bg-emerald-600 hover:bg-emerald-700' :
                  verifyMethod === 'face' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {pwdLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {pwdLoading ? '提交中...' : verifyMethod === 'face' ? '开始人脸验证' : '确认修改'}
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
              <SafeImg
                src={resolveStaticUrl(avatar)}
                fallback={
                  <div className="w-28 h-28 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-4xl font-semibold border-4 border-gray-700">
                    {initial}
                  </div>
                }
                className="w-28 h-28 rounded-full object-cover border-4 border-gray-700"
              />
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
            {modelStatus === 'loading' && (
              <div className="bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs rounded-lg p-2 mb-3 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>正在加载人脸识别模型（约 6.2MB），请稍候...</span>
              </div>
            )}
            {modelStatus === 'error' && (
              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs rounded-lg p-2 mb-3">
                人脸识别模型加载失败，将使用兼容模式（精度较低）
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

      {/* 密码修改 - 人脸验证模态框 */}
      {pwdFaceModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={closePwdFaceModal}>
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <ScanFace className="w-5 h-5 text-purple-300" />
              人脸验证
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              请正对着摄像头，保持光线充足，完成人脸验证后将自动修改密码。
            </p>
            <div className="relative bg-black rounded-xl overflow-hidden aspect-video mb-3">
              <video
                ref={pwdVideoRef}
                playsInline
                muted
                autoPlay
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
              {!pwdFaceReady && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
                  摄像头未启动
                </div>
              )}
              <canvas ref={pwdCanvasRef} className="hidden" />
            </div>
            {pwdError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg p-2 mb-3">
                {pwdError}
              </div>
            )}
            <div className="flex gap-2">
              {!pwdFaceReady && (
                <button
                  onClick={startPwdFaceCamera}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
                >
                  启动摄像头
                </button>
              )}
              {pwdFaceReady && (
                <button
                  onClick={handleVerifyFaceForPassword}
                  disabled={pwdFaceLoading}
                  className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {pwdFaceLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {pwdFaceLoading ? '验证中...' : '开始验证'}
                </button>
              )}
              <button
                onClick={closePwdFaceModal}
                disabled={pwdFaceLoading}
                className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 通用弹窗提示 */}
      {toast && (
        <ToastModal
          type={toast.type}
          title={toast.title}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}
