import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useMomentsStore } from '@/store/momentsStore'
import { api, resolveStaticUrl, type Post, type Comment } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { ArrowLeft, MessageCircle, Send, ImageIcon, Trash2, X, VideoIcon, Shield, Users, Globe, Reply, ChevronDown, ChevronUp } from 'lucide-react'
import UserProfileModal from '@/components/UserProfileModal'
import SafeImg from '@/components/SafeImg'

type AuthorUser = {
  userId: number
  username: string
  avatar?: string
  bio?: string
  gender?: string
  region?: string
}

type TabType = 'official' | 'friends' | 'square'

function PostCard({ post, onComment, onDelete, onEnlarge, onAvatarClick, highlightCommentId, clearHighlight }: { post: Post; onComment: () => void; onDelete: (id: number) => void; onEnlarge: (url: string) => void; onAvatarClick: (author: AuthorUser) => void; highlightCommentId?: number | null; clearHighlight?: () => void }) {
  const user = useAuthStore((s) => s.user)
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentText, setCommentText] = useState('')
  const [loadingComments, setLoadingComments] = useState(false)
  const [replyTo, setReplyTo] = useState<{ commentId: number; username: string; userId: number } | null>(null)
  const [visibleCount, setVisibleCount] = useState(10)
  const [expandedReplies, setExpandedReplies] = useState<Set<number>>(new Set())
  const [replyVisibleCounts, setReplyVisibleCounts] = useState<Record<number, number>>({})

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

  // 如果有关联高亮，自动展开评论并确保可见
  useEffect(() => {
    if (highlightCommentId) {
      setShowComments(true)
      setVisibleCount(999)
      // 如果高亮的是回复，展开其父评论
      const target = comments.find((c) => c.id === highlightCommentId)
      if (target?.parentId) {
        setExpandedReplies((prev) => new Set(prev).add(target.parentId!))
        setReplyVisibleCounts((prev) => ({ ...prev, [target.parentId!]: 999 }))
      }
    }
  }, [highlightCommentId, comments])

  // 高亮评论：滚动到该评论位置，1.5秒后恢复
  useEffect(() => {
    if (highlightCommentId && showComments && comments.length > 0) {
      setTimeout(() => {
        const el = document.getElementById(`comment-${highlightCommentId}`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('highlight-comment')
          setTimeout(() => {
            el.classList.remove('highlight-comment')
            clearHighlight?.()
          }, 1500)
        }
      }, 300)
    }
  }, [highlightCommentId, showComments, comments, clearHighlight])

  const handleComment = async () => {
    if (!commentText.trim()) return
    try {
      const res = await api.createComment(
        post.id,
        commentText.trim(),
        replyTo?.commentId,
        replyTo?.userId
      )
      setComments((prev) => [...prev, res.comment])
      setCommentText('')
      setReplyTo(null)
      onComment()
      const socket = getSocket()
      if (socket) {
        socket.emit('new_comment', { comment: res.comment, postId: post.id })
      }
    } catch (err: any) {
      alert(err.message)
    }
  }

  const handleDeleteComment = async (commentId: number) => {
    if (!confirm('确定删除这条评论吗？')) return
    try {
      await api.deleteComment(post.id, commentId)
      setComments((prev) => prev.filter((c) => c.id !== commentId && c.parentId !== commentId))
    } catch (err: any) {
      alert(err.message)
    }
  }

  const formatTime = (t: string) => {
    if (!t) return ''
    const d = new Date(t)
    if (isNaN(d.getTime())) return ''
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    if (isToday) return `${h}:${m}`
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${h}:${m}`
  }

  const isVideo = post.imageUrl ? /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(post.imageUrl) : false

  // 将评论按嵌套关系组织：顶层评论 + 其回复
  const topLevelComments = comments.filter((c) => !c.parentId)
  const getReplies = (commentId: number) => comments.filter((c) => c.parentId === commentId)

  return (
    <div className="bg-[#1E293B] rounded-2xl overflow-hidden">
      {/* 内容 */}
      <div className="p-5">
        <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">{post.content}</p>
        {post.imageUrl && isVideo && (
          <video
            src={resolveStaticUrl(post.imageUrl)}
            controls
            preload="metadata"
            className="mt-3 rounded-xl max-h-80 w-full bg-black"
          />
        )}
        {post.imageUrl && !isVideo && (
          <button
            onClick={() => onEnlarge(resolveStaticUrl(post.imageUrl))}
            className="block w-full text-left mt-3"
          >
            <img
              src={resolveStaticUrl(post.imageUrl)}
              alt=""
              className="rounded-xl max-h-60 w-full object-contain bg-[#0F172A] hover:opacity-90 transition-opacity"
              loading="lazy"
            />
          </button>
        )}
      </div>

      {/* 作者信息 */}
      <div className="px-5 pb-3 flex items-start gap-2">
        <button onClick={() => onAvatarClick({ userId: post.userId, username: post.username, avatar: post.avatar, bio: post.bio, gender: post.gender, region: post.region })} className="flex-shrink-0">
          <SafeImg
            src={resolveStaticUrl(post.avatar || '')}
            fallback={
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold mt-0.5">
                {post.username[0]?.toUpperCase()}
              </div>
            }
            className="w-6 h-6 rounded-full object-cover mt-0.5"
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-blue-400 font-medium">{post.username}</span>
            {post.isOfficial === 1 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded text-[10px] font-medium">
                <Shield className="w-2.5 h-2.5" />
                官方
              </span>
            )}
            {post.gender === 'male' && <span className="text-[10px] text-blue-400">♂</span>}
            {post.gender === 'female' && <span className="text-[10px] text-pink-400">♀</span>}
            {post.gender === 'other' && <span className="text-[10px] text-gray-400">⚧</span>}
            {post.region && (
              <span className="text-gray-600 flex items-center gap-0.5">
                <span>📍</span>
                <span className="truncate max-w-[80px]">{post.region}</span>
              </span>
            )}
            <span className="text-gray-600 ml-auto">{formatTime(post.createdAt)}</span>
          </div>
          {post.bio && (
            <p className="text-[11px] text-gray-500 italic mt-0.5 truncate">"{post.bio}"</p>
          )}
        </div>
        {(user?.id === post.userId || user?.isOfficial === 1) && (
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
            <div className="max-h-80 overflow-y-auto p-4">
              {comments.length === 0 ? (
                <p className="text-gray-500 text-sm text-center">暂无评论</p>
              ) : (
                <>
                  <div className="space-y-2">
                    {topLevelComments.slice(0, visibleCount).map((c) => {
                      const replies = getReplies(c.id)
                      const isExpanded = expandedReplies.has(c.id)
                      const replyMax = replyVisibleCounts[c.id] || 10
                      const visibleReplies = replies.slice(0, replyMax)
                      const hasMoreReplies = replies.length > replyMax
                      return (
                        <div key={c.id}>
                          <div id={`comment-${c.id}`} className="flex gap-2.5 group transition-colors duration-300 rounded-lg p-1 -mx-1">
                            <button onClick={() => onAvatarClick({ userId: c.userId, username: c.username, avatar: c.avatar, bio: c.bio, gender: c.gender, region: c.region })} className="flex-shrink-0">
                              <SafeImg
                                src={resolveStaticUrl(c.avatar || '')}
                                fallback={
                                  <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-semibold mt-0.5">
                                    {c.username[0]?.toUpperCase()}
                                  </div>
                                }
                                className="w-7 h-7 rounded-full object-cover mt-0.5"
                              />
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-1.5 flex-wrap">
                                <span className="text-xs text-blue-400 font-medium">{c.username}</span>
                                {c.gender === 'male' && <span className="text-[10px] text-blue-400">♂</span>}
                                {c.gender === 'female' && <span className="text-[10px] text-pink-400">♀</span>}
                                {c.gender === 'other' && <span className="text-[10px] text-gray-400">⚧</span>}
                                {c.region && (
                                  <span className="text-gray-600 text-[11px] flex items-center gap-0.5">
                                    <span>📍</span>
                                    <span className="truncate max-w-[80px]">{c.region}</span>
                                  </span>
                                )}
                                <span className="text-xs text-gray-600">{formatTime(c.createdAt)}</span>
                              </div>
                              <p className="text-sm text-gray-300 mt-0.5">{c.content}</p>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setReplyTo({ commentId: c.id, username: c.username, userId: c.userId })}
                                  className="text-[11px] text-gray-500 hover:text-blue-400 transition-colors mt-0.5 flex items-center gap-0.5"
                                >
                                  <Reply className="w-3 h-3" />
                                  回复
                                </button>
                                {(user?.id === c.userId || user?.isOfficial === 1) && (
                                  <button
                                    onClick={() => handleDeleteComment(c.id)}
                                    className="text-[11px] text-gray-500 hover:text-red-400 transition-colors mt-0.5 flex items-center gap-0.5"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    删除
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 回复折叠/展开按钮 */}
                          {replies.length > 0 && !isExpanded && (
                            <button
                              onClick={() => setExpandedReplies((prev) => new Set(prev).add(c.id))}
                              className="ml-9 mt-1 text-[11px] text-gray-500 hover:text-blue-400 transition-colors flex items-center gap-1"
                            >
                              <ChevronDown className="w-3 h-3" />
                              查看回复 ({replies.length})
                            </button>
                          )}

                          {/* 回复列表 */}
                          {isExpanded && replies.length > 0 && (
                            <div className="ml-9 mt-1 border-l-2 border-gray-700/50 pl-3">
                              <div className="space-y-2">
                                {visibleReplies.map((reply) => (
                                  <div key={reply.id} id={`comment-${reply.id}`} className="flex gap-2.5 transition-colors duration-300 rounded-lg p-1 -mx-1">
                                    <button onClick={() => onAvatarClick({ userId: reply.userId, username: reply.username, avatar: reply.avatar, bio: reply.bio, gender: reply.gender, region: reply.region })} className="flex-shrink-0">
                                      <SafeImg
                                        src={resolveStaticUrl(reply.avatar || '')}
                                        fallback={
                                          <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center text-white text-[10px] font-semibold">
                                            {reply.username[0]?.toUpperCase()}
                                          </div>
                                        }
                                        className="w-6 h-6 rounded-full object-cover"
                                      />
                                    </button>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-baseline gap-1.5 flex-wrap">
                                        <span className="text-xs text-blue-400 font-medium">{reply.username}</span>
                                        {reply.replyToUsername && (
                                          <span className="text-[11px] text-gray-500">
                                            回复 <span className="text-blue-400/70">@{reply.replyToUsername}</span>
                                          </span>
                                        )}
                                        <span className="text-[10px] text-gray-600">{formatTime(reply.createdAt)}</span>
                                      </div>
                                      <p className="text-sm text-gray-300 mt-0.5">{reply.content}</p>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => setReplyTo({ commentId: c.id, username: reply.username, userId: reply.userId })}
                                          className="text-[11px] text-gray-500 hover:text-blue-400 transition-colors mt-0.5 flex items-center gap-0.5"
                                        >
                                          <Reply className="w-3 h-3" />
                                          回复
                                        </button>
                                        {(user?.id === reply.userId || user?.isOfficial === 1) && (
                                          <button
                                            onClick={() => handleDeleteComment(reply.id)}
                                            className="text-[11px] text-gray-500 hover:text-red-400 transition-colors mt-0.5 flex items-center gap-0.5"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                            删除
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                {hasMoreReplies && (
                                  <button
                                    onClick={() => setReplyVisibleCounts((prev) => ({ ...prev, [c.id]: replyMax + 10 }))}
                                    className="text-[11px] text-gray-500 hover:text-blue-400 transition-colors flex items-center gap-1"
                                  >
                                    <ChevronDown className="w-3 h-3" />
                                    展开更多回复
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setExpandedReplies((prev) => {
                                      const next = new Set(prev)
                                      next.delete(c.id)
                                      return next
                                    })
                                    setReplyVisibleCounts((prev) => {
                                      const next = { ...prev }
                                      delete next[c.id]
                                      return next
                                    })
                                  }}
                                  className="text-[11px] text-gray-500 hover:text-gray-400 transition-colors flex items-center gap-1"
                                >
                                  <ChevronUp className="w-3 h-3" />
                                  收起回复
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* 展开更多评论 */}
                  {topLevelComments.length > visibleCount && (
                    <button
                      onClick={() => setVisibleCount((prev) => prev + 10)}
                      className="w-full mt-2 py-1.5 text-xs text-gray-400 hover:text-blue-400 hover:bg-gray-700/30 rounded-lg transition-colors flex items-center justify-center gap-1"
                    >
                      <ChevronDown className="w-3 h-3" />
                      展开更多评论 ({topLevelComments.length - visibleCount} 条)
                    </button>
                  )}

                  {/* 收起评论 */}
                  {visibleCount > 10 && (
                    <button
                      onClick={() => setVisibleCount(10)}
                      className="w-full mt-1 py-1.5 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-700/30 rounded-lg transition-colors flex items-center justify-center gap-1"
                    >
                      <ChevronUp className="w-3 h-3" />
                      收起
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* 输入评论 */}
          <div className="border-t border-gray-800 p-3">
            {replyTo && (
              <div className="flex items-center gap-2 mb-2 text-xs text-gray-400">
                <span>回复 @{replyTo.username}</span>
                <button onClick={() => setReplyTo(null)} className="text-gray-500 hover:text-gray-300">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleComment() }}
                className="flex-1 px-3 py-1.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder={replyTo ? `回复 ${replyTo.username}...` : '写评论...'}
              />
              <button
                onClick={handleComment}
                disabled={!commentText.trim()}
                className="p-1.5 text-blue-400 hover:text-blue-300 disabled:text-gray-600 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => setShowComments(false)}
              className="w-full mt-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-700/30 rounded-lg transition-colors flex items-center justify-center gap-1"
            >
              <ChevronUp className="w-3 h-3" />
              收起评论
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Moments() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const posts = useMomentsStore((s) => s.posts)
  const setPosts = useMomentsStore((s) => s.setPosts)
  const addPost = useMomentsStore((s) => s.addPost)
  const removePost = useMomentsStore((s) => s.removePost)
  const addComment = useMomentsStore((s) => s.addComment)
  const [loading, setLoading] = useState(true)
  const [enlargedImage, setEnlargedImage] = useState('')
  const [selectedProfileUser, setSelectedProfileUser] = useState<AuthorUser | null>(null)
  const [friends, setFriends] = useState<Array<{ id: number }>>([])
  const [activeTab, setActiveTab] = useState<TabType>('square')
  const [highlightPostId, setHighlightPostId] = useState<number | null>(null)
  const [highlightCommentId, setHighlightCommentId] = useState<number | null>(null)

  // 从 URL 中读取高亮参数（来自通知跳转）
  useEffect(() => {
    const postId = searchParams.get('highlightPost')
    const commentId = searchParams.get('highlightComment')
    if (postId) {
      setHighlightPostId(parseInt(postId, 10))
      setHighlightCommentId(commentId ? parseInt(commentId, 10) : null)
      // 清除 URL 参数
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('highlightPost')
      newParams.delete('highlightComment')
      setSearchParams(newParams, { replace: true })
    }
  }, [])

  const loadPosts = useCallback(async (tab?: string) => {
    setLoading(true)
    try {
      const res = await api.getPosts(tab)
      setPosts(res.posts)
    } catch {} finally {
      setLoading(false)
    }
  }, [setPosts])

  useEffect(() => {
    loadPosts(activeTab)
    api.getFriends().then((res) => setFriends(res.friends)).catch(() => {})
  }, [loadPosts, activeTab])

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

  const handleAvatarClick = (author: AuthorUser) => {
    setSelectedProfileUser(author)
  }

  const handleAddFriend = async (userId: number, username: string) => {
    const res = await api.sendFriendRequest(username)
    try {
      const fr = await api.getFriends()
      setFriends(fr.friends)
    } catch {}
    return res
  }

  const tabs: Array<{ key: TabType; label: string; icon: typeof Shield }> = [
    { key: 'official', label: '官方', icon: Shield },
    { key: 'friends', label: '好友', icon: Users },
    { key: 'square', label: '广场', icon: Globe },
  ]

  return (
    <div className="h-screen bg-[#0F172A] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/friends')}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-white font-semibold text-lg">动态</h1>
        </div>
        {(activeTab === 'square') && (
          <button
            onClick={() => navigate('/moments/create')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            发布动态
          </button>
        )}
      </header>

      {/* 分栏标签 */}
      <div className="bg-[#1E293B] border-b border-gray-800 px-4 py-2">
        <div className="flex gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

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
          <div className="flex flex-col items-center justify-center h-full text-center pt-20">
            <MessageCircle className="w-16 h-16 text-gray-600 mb-4" />
            <p className="text-gray-400 text-lg mb-2">
              {activeTab === 'official' ? '暂无官方动态' : activeTab === 'friends' ? '好友还没有发布动态' : '还没有动态'}
            </p>
            <p className="text-gray-500 text-sm mb-6">
              {activeTab === 'official' && user?.isOfficial !== 1
                ? '仅官方账号可在此发布动态'
                : activeTab === 'friends'
                ? '好友动态将自动同步好友的帖子'
                : '去广场发布第一条动态'}
            </p>
            {(activeTab === 'square') && (
              <button
                onClick={() => navigate('/moments/create')}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                发布动态
              </button>
            )}
          </div>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onComment={() => {}}
              onDelete={handleDelete}
              onEnlarge={(url) => setEnlargedImage(url)}
              onAvatarClick={handleAvatarClick}
              highlightCommentId={highlightPostId === post.id ? highlightCommentId : null}
              clearHighlight={() => { setHighlightPostId(null); setHighlightCommentId(null) }}
            />
          ))
        )}
      </div>

      {/* 放大图片遮罩层 */}
      {enlargedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={() => setEnlargedImage('')}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setEnlargedImage('') }}
            className="absolute top-4 right-4 p-2 text-white hover:text-gray-300 bg-black/50 rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={enlargedImage}
            alt=""
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* 用户资料卡弹窗 */}
      {selectedProfileUser && (
        <UserProfileModal
          user={{
            id: selectedProfileUser.userId,
            username: selectedProfileUser.username,
            avatar: selectedProfileUser.avatar,
            bio: selectedProfileUser.bio,
            gender: selectedProfileUser.gender,
            region: selectedProfileUser.region,
          }}
          currentUserId={user?.id || 0}
          isFriend={friends.some((f) => f.id === selectedProfileUser.userId)}
          onClose={() => setSelectedProfileUser(null)}
          onAddFriend={handleAddFriend}
        />
      )}
    </div>
  )
}