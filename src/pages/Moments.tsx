import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useMomentsStore } from '@/store/momentsStore'
import { api, type Post, type Comment } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { ArrowLeft, MessageCircle, Send, ImageIcon, Trash2 } from 'lucide-react'

function PostCard({ post, onComment, onDelete }: { post: Post; onComment: () => void; onDelete: (id: number) => void }) {
  const user = useAuthStore((s) => s.user)
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentText, setCommentText] = useState('')
  const [loadingComments, setLoadingComments] = useState(false)

  const loadComments = useCallback(async () => {
    setLoadingComments(true)
    try {
      const res = await api.getComments(post.id)
      setComments(res.comments)
    } catch {} finally {
      setLoadingComments(false)
    }
  }, [post.id])

  useEffect(() => {
    if (showComments) loadComments()
  }, [showComments, loadComments])

  const handleComment = async () => {
    if (!commentText.trim()) return
    try {
      const res = await api.createComment(post.id, commentText.trim())
      setComments((prev) => [...prev, res.comment])
      setCommentText('')
      onComment()
      // 实时转发评论
      const socket = getSocket()
      if (socket) {
        socket.emit('new_comment', { comment: res.comment, postId: post.id })
      }
    } catch (err: any) {
      alert(err.message)
    }
  }

  const formatTime = (t: string) => {
    const d = new Date(t)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    if (isToday) return `${h}:${m}`
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${h}:${m}`
  }

  return (
    <div className="bg-[#1E293B] rounded-2xl overflow-hidden">
      {/* 内容 */}
      <div className="p-5">
        <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">{post.content}</p>
        {post.imageUrl && (
          <img
            src={post.imageUrl}
            alt=""
            className="mt-3 rounded-xl max-h-60 w-full object-contain bg-[#0F172A]"
            loading="lazy"
          />
        )}
      </div>

      {/* 作者信息 */}
      <div className="px-5 pb-3 flex items-center gap-2">
        {post.avatar ? (
          <img src={post.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
        ) : (
          <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold">
            {post.username[0]?.toUpperCase()}
          </div>
        )}
        <span className="text-xs text-gray-400">{post.username}</span>
        <span className="text-xs text-gray-600 ml-auto">{formatTime(post.createdAt)}</span>
        {user?.id === post.userId && (
          <button
            onClick={() => onDelete(post.id)}
            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            title="删除动态"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 评论按钮 */}
      <div className="px-5 pb-4 border-t border-gray-800 pt-3">
        <button
          onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-1.5 text-gray-400 hover:text-blue-400 transition-colors text-sm"
        >
          <MessageCircle className="w-4 h-4" />
          评论 ({post.commentCount})
        </button>
      </div>

      {/* 评论区域 */}
      {showComments && (
        <div className="border-t border-gray-800">
          {loadingComments ? (
            <div className="p-4 text-center text-gray-500 text-sm">加载中...</div>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-3 p-4">
              {comments.length === 0 ? (
                <p className="text-gray-500 text-sm text-center">暂无评论</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    {c.avatar ? (
                      <img src={c.avatar} alt="" className="w-7 h-7 rounded-full object-cover mt-0.5 flex-shrink-0" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                        {c.username[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-blue-400 font-medium">{c.username}</span>
                        <span className="text-xs text-gray-600">{formatTime(c.createdAt)}</span>
                      </div>
                      <p className="text-sm text-gray-300 mt-0.5">{c.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 输入评论 */}
          <div className="flex items-center gap-2 border-t border-gray-800 p-3">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleComment() }}
              className="flex-1 px-3 py-1.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="写评论..."
            />
            <button
              onClick={handleComment}
              disabled={!commentText.trim()}
              className="p-1.5 text-blue-400 hover:text-blue-300 disabled:text-gray-600 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Moments() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const posts = useMomentsStore((s) => s.posts)
  const setPosts = useMomentsStore((s) => s.setPosts)
  const addPost = useMomentsStore((s) => s.addPost)
  const removePost = useMomentsStore((s) => s.removePost)
  const addComment = useMomentsStore((s) => s.addComment)
  const [loading, setLoading] = useState(true)

  const loadPosts = useCallback(async () => {
    try {
      const res = await api.getPosts()
      setPosts(res.posts)
    } catch {} finally {
      setLoading(false)
    }
  }, [setPosts])

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  // Socket 实时监听
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const handleNewPost = (post: Post) => {
      addPost(post)
    }
    const handleNewComment = (data: { comment: Comment; postId: number }) => {
      addComment(data.postId, data.comment)
    }
    const handlePostDeleted = (postId: number) => {
      removePost(postId)
    }

    socket.on('new_post', handleNewPost)
    socket.on('new_comment', handleNewComment)
    socket.on('post_deleted', handlePostDeleted)

    return () => {
      socket.off('new_post', handleNewPost)
      socket.off('new_comment', handleNewComment)
      socket.off('post_deleted', handlePostDeleted)
    }
  }, [addPost, addComment, removePost])

  const handleDelete = async (postId: number) => {
    if (!confirm('确定删除这条动态吗？')) return
    try {
      await api.deletePost(postId)
      removePost(postId)
      const socket = getSocket()
      if (socket) {
        socket.emit('post_deleted', postId)
      }
    } catch (err: any) {
      alert(err.message)
    }
  }

  return (
    <div className="min-h-screen bg-[#0F172A] flex flex-col">
      {/* Header */}
      <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/friends')}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-white font-semibold text-lg">动态广场</h1>
        </div>
        <button
          onClick={() => navigate('/moments/create')}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          发布动态
        </button>
      </header>

      {/* Posts */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-[#1E293B] rounded-2xl p-5 animate-pulse">
                <div className="h-4 bg-gray-700 rounded w-3/4 mb-3" />
                <div className="h-4 bg-gray-700 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageCircle className="w-16 h-16 text-gray-600 mb-4" />
            <p className="text-gray-400 text-lg mb-2">还没有动态</p>
            <p className="text-gray-500 text-sm mb-6">点击右上角发布第一条动态</p>
            <button
              onClick={() => navigate('/moments/create')}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              发布动态
            </button>
          </div>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onComment={() => {}}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  )
}