import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMomentsStore } from '@/store/momentsStore'
import { api } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { ArrowLeft, ImageIcon, X } from 'lucide-react'

export default function CreatePost() {
  const navigate = useNavigate()
  const addPost = useMomentsStore((s) => s.addPost)
  const [content, setContent] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件')
      return
    }
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const removeImage = () => {
    setImageFile(null)
    setImagePreview('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async () => {
    if (!content.trim() && !imageFile) {
      alert('请输入内容或选择图片')
      return
    }
    setSubmitting(true)
    try {
      let finalImageUrl = ''
      if (imageFile) {
        const uploadRes = await api.uploadFile(imageFile)
        finalImageUrl = uploadRes.url
      }
      const res = await api.createPost(content.trim(), finalImageUrl)
      addPost(res.post)
      // 实时转发动态
      const socket = getSocket()
      if (socket) {
        socket.emit('new_post', res.post)
      }
      navigate('/moments')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0F172A] flex flex-col">
      {/* Header */}
      <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/moments')}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-white font-semibold text-lg">发布动态</h1>
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || (!content.trim() && !imageFile)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm rounded-lg transition-colors"
        >
          {submitting ? '发布中...' : '发布'}
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 p-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full h-40 bg-transparent text-white text-base placeholder-gray-500 resize-none focus:outline-none"
          placeholder="说点什么..."
        />

        {/* Image preview */}
        {imagePreview && (
          <div className="relative inline-block mt-3">
            <img
              src={imagePreview}
              alt=""
              className="max-h-60 rounded-xl object-cover"
            />
            <button
              onClick={removeImage}
              className="absolute top-2 right-2 p-1 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Image button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="mt-4 flex items-center gap-2 px-4 py-2 bg-[#1E293B] hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
        >
          <ImageIcon className="w-5 h-5" />
          <span className="text-sm">添加图片</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />
      </div>
    </div>
  )
}