import { create } from 'zustand'
import type { Post, Comment } from '@/lib/api'

interface MomentsState {
  posts: Post[]
  comments: Record<number, Comment[]>
  setPosts: (posts: Post[]) => void
  addPost: (post: Post) => void
  removePost: (postId: number) => void
  setComments: (postId: number, comments: Comment[]) => void
  addComment: (postId: number, comment: Comment) => void
}

export const useMomentsStore = create<MomentsState>((set) => ({
  posts: [],
  comments: {},
  setPosts: (posts) => set({ posts }),
  addPost: (post) =>
    set((state) => ({ posts: [post, ...state.posts] })),
  removePost: (postId) =>
    set((state) => ({
      posts: state.posts.filter((p) => p.id !== postId),
    })),
  setComments: (postId, comments) =>
    set((state) => ({ comments: { ...state.comments, [postId]: comments } })),
  addComment: (postId, comment) =>
    set((state) => {
      const existing = state.comments[postId] || []
      return {
        comments: { ...state.comments, [postId]: [...existing, comment] },
        posts: state.posts.map((p) =>
          p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p
        ),
      }
    }),
}))