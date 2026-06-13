import { useState, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/lib/api'
import { MessageCircle } from 'lucide-react'

export default function Register() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval>>()
  const register = useAuthStore((s) => s.register)
  const navigate = useNavigate()

  const startCountdown = () => {
    setCountdown(60)
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const handleSendCode = async () => {
    if (!email) {
      setError('请先输入邮箱')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入正确的邮箱格式')
      return
    }

    setSending(true)
    setError('')
    try {
      const res = await api.sendVerificationCode(email)
      if (!res.sent) {
        setError('邮件服务未配置，验证码已在服务器控制台输出')
      } else {
        startCountdown()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    setLoading(true)
    try {
      await register(username, email, password, code)
      navigate('/friends')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 mb-4">
            <MessageCircle className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-3xl font-bold text-white">ChatRoom</h1>
          <p className="text-gray-400 mt-2">创建你的账号</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#1E293B] rounded-2xl p-6 shadow-xl space-y-4">
          <h2 className="text-xl font-semibold text-white text-center">注册</h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-300 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="2-20个字符"
              required
              minLength={2}
              maxLength={20}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="请输入邮箱"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">验证码</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="flex-1 px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="请输入验证码"
                required
                maxLength={6}
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sending || countdown > 0}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
              >
                {sending ? '发送中...' : countdown > 0 ? `${countdown}s` : '发送验证码'}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="至少6个字符"
              required
              minLength={6}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">确认密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="再次输入密码"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? '注册中...' : '注册'}
          </button>

          <p className="text-center text-sm text-gray-400">
            已有账号？{' '}
            <Link to="/" className="text-blue-400 hover:text-blue-300 transition-colors">
              立即登录
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}