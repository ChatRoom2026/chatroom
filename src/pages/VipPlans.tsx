import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/lib/api'
import { ArrowLeft, Crown, Check, Loader2 } from 'lucide-react'

interface Plan {
  id: string
  name: string
  price: number
  days: number
  badge: string
}

export default function VipPlans() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [plans, setPlans] = useState<Plan[]>([])
  const [selectedPlan, setSelectedPlan] = useState<string>('yearly')
  const [step, setStep] = useState<'plans' | 'pay' | 'paid'>('plans')
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [payData, setPayData] = useState<any>(null)
  const [activating, setActivating] = useState(false)
  const [successData, setSuccessData] = useState<any>(null)

  useEffect(() => {
    api.getVipPlans().then((res) => {
      setPlans(res.plans)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleSelect = async () => {
    if (!selectedPlan) return
    setPaying(true)
    try {
      const res = await api.payVip(selectedPlan)
      setPayData(res)
      setStep('pay')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setPaying(false)
    }
  }

  const handleConfirmPay = async () => {
    if (!payData?.outTradeNo) return
    setActivating(true)
    try {
      const res = await api.confirmVipPayment(payData.outTradeNo)
      if (res.success) {
        setSuccessData(res)
        setStep('paid')
        // 更新 localStorage
        const userStr = localStorage.getItem('user')
        if (userStr) {
          const u = JSON.parse(userStr)
          u.vip = 1
          localStorage.setItem('user', JSON.stringify(u))
        }
        // 同步更新 Zustand store，左侧栏立即显示 VIP 标识
        useAuthStore.setState({ user: { ...useAuthStore.getState().user!, vip: 1 } })
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setActivating(false)
    }
  }

  const formatExpiry = (dateStr: string) => {
    const d = new Date(dateStr)
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }

  if (step === 'paid') {
    return (
      <div className="min-h-screen bg-[#0F172A] flex flex-col">
        <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/friends')} className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-white font-semibold text-lg">开通结果</h1>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-green-400" />
            </div>
            <h2 className="text-white text-2xl font-bold mb-2">开通成功！</h2>
            <p className="text-gray-400 mb-2">感谢你的支持</p>
            {successData?.expiresAt && (
              <p className="text-gray-500 text-sm">
                VIP 有效期至 {formatExpiry(successData.expiresAt)}
              </p>
            )}
            <button
              onClick={() => navigate('/friends')}
              className="mt-8 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors"
            >
              返回首页
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'pay') {
    return (
      <div className="min-h-screen bg-[#0F172A] flex flex-col">
        <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setStep('plans')} className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-white font-semibold text-lg">确认支付</h1>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-sm bg-[#1E293B] rounded-2xl p-8 text-center">
            <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Crown className="w-8 h-8 text-yellow-400" />
            </div>
            <p className="text-white text-lg font-semibold mb-1">{payData?.plan?.name || 'VIP会员'}</p>
            <p className="text-gray-500 text-xs mb-6">点击下方按钮立即开通</p>

            <div className="text-3xl text-white font-bold mb-6">
              ¥{payData?.plan?.price || 0}
            </div>

            <button
              onClick={handleConfirmPay}
              disabled={activating}
              className="w-full py-3.5 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2"
            >
              {activating ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Crown className="w-5 h-5" />
              )}
              {activating ? '开通中...' : '立即开通'}
            </button>

            <p className="text-gray-500 text-xs mt-4">模拟支付，点击即开通</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0F172A] flex flex-col">
      {/* Header */}
      <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate('/friends')}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-white font-semibold text-lg">开通VIP</h1>
          <p className="text-xs text-gray-500">尊享更多特权</p>
        </div>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* VIP 特权展示 */}
        <div className="px-4 pt-8 pb-2 text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-yellow-500/20">
            <Crown className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-white text-xl font-bold mb-1">成为 VIP 会员</h2>
          <p className="text-gray-400 text-sm">解锁全部功能，享受更好的体验</p>
        </div>

        {/* 特权列表 */}
        <div className="px-4 py-3">
          <div className="bg-[#1E293B] rounded-2xl p-4 border border-yellow-500/10">
            <p className="text-yellow-400 text-sm font-medium mb-3 flex items-center gap-1.5"><Crown className="w-4 h-4" />VIP 专属特权</p>
            <div className="space-y-2.5">
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-2 flex-shrink-0" />
                <div>
                  <p className="text-white text-sm">超大文件上传</p>
                  <p className="text-gray-500 text-xs">VIP 可上传最大 500MB 文件（普通用户仅 10MB）</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-2 flex-shrink-0" />
                <div>
                  <p className="text-white text-sm">VIP 身份标识</p>
                  <p className="text-gray-500 text-xs">头像皇冠徽章、用户名皇冠图标、消息金色边框</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-2 flex-shrink-0" />
                <div>
                  <p className="text-white text-sm">优先体验新功能</p>
                  <p className="text-gray-500 text-xs">抢先使用最新开发的功能特性</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-2 flex-shrink-0" />
                <div>
                  <p className="text-white text-sm">无限存储空间</p>
                  <p className="text-gray-500 text-xs">上传文件不占用个人空间限制</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Plans scrollable area */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 bg-[#1E293B] rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              <p className="text-gray-400 text-sm font-medium px-1 pt-2 mb-3">选择套餐</p>
              <div className="grid grid-cols-3 gap-3">
                {plans.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`p-3 rounded-2xl text-center transition-all border-2 flex flex-col items-center justify-center min-h-[100px] ${
                      selectedPlan === plan.id
                        ? 'bg-blue-600/10 border-blue-500 shadow-lg shadow-blue-500/10'
                        : 'bg-[#1E293B] border-transparent hover:border-gray-700'
                    }`}
                  >
                    {plan.badge && (
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium mb-1 ${
                        plan.badge === '最划算'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : plan.badge === '热销'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-blue-500/20 text-blue-400'
                      }`}>
                        {plan.badge}
                      </span>
                    )}
                    <span className="text-white text-sm font-semibold leading-tight">{plan.name}</span>
                    <span className="text-yellow-400 text-lg font-bold mt-1">¥{plan.price}</span>
                    <span className="text-gray-500 text-[10px] mt-0.5">
                      {plan.days < 1
                        ? '1小时'
                        : plan.days === 1
                        ? '1天'
                        : plan.days === 7
                        ? '7天'
                        : plan.days >= 365
                        ? '365天'
                        : plan.days >= 90
                        ? '90天'
                        : `${plan.days}天`}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Fixed bottom pay button */}
      {!loading && (
        <div className="bg-[#0F172A] border-t border-gray-800 p-4 flex-shrink-0">
          <button
            onClick={handleSelect}
            disabled={paying || !selectedPlan}
            className="w-full py-3.5 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-xl font-semibold text-lg transition-all disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {paying ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Crown className="w-5 h-5" />
            )}
            {paying ? '处理中...' : `立即开通 · ¥${plans.find(p => p.id === selectedPlan)?.price || 0}`}
          </button>
        </div>
      )}
    </div>
  )
}