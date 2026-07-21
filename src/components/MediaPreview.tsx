/**
 * 媒体预览组件 —— 解决视频"仅可预览一次"问题
 *
 * 关键设计：
 *  ① 消息流中的视频：显示为带播放图标的"视频卡片"，点击进入全屏模态框播放
 *  ② 模态框中的 video 元素：每次打开都重新创建（key={openTime}），避免 WebView 解码器缓存
 *  ③ 提供双指捏合 / 滚轮缩放（可选简化版）
 *  ④ 模态框关闭时彻底清空 src，释放内存
 */
import { useState, useEffect, useRef } from 'react'
import { X, Play, Download, ZoomIn, ZoomOut, RotateCw } from 'lucide-react'
import { resolveStaticUrl } from '@/lib/api'

interface MediaPreviewProps {
  type: 'image' | 'video'
  url: string
  filename?: string
  // 消息中显示的尺寸（默认 240px 宽）
  thumbSize?: number
}

export function MediaPreview({ type, url, filename, thumbSize = 240 }: MediaPreviewProps) {
  const resolvedUrl = resolveStaticUrl(url)
  const [open, setOpen] = useState(false)
  // 视频缩略图：显示首帧（用 lazy loading 避免阻塞）
  const videoRef = useRef<HTMLVideoElement>(null)

  // 模态框中：每次 open 重新创建 video 元素
  const [openKey, setOpenKey] = useState(0)
  // 缩放 & 旋转
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(true)
    setOpenKey((k) => k + 1) // 强制重新创建 video 元素
    setZoom(1)
    setRotation(0)
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    const a = document.createElement('a')
    a.href = resolvedUrl
    a.download = filename || 'download'
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <>
      {/* 缩略图：图片直接显示，视频显示带播放图标的封面 */}
      {type === 'image' ? (
        <button
          onClick={handleOpen}
          className="block rounded-2xl overflow-hidden hover:opacity-90 active:opacity-75 transition-opacity"
          style={{ maxWidth: thumbSize, maxHeight: thumbSize * 1.4 }}
        >
          <img
            src={resolvedUrl}
            alt={filename || 'image'}
            className="block object-contain bg-[#0F172A]"
            style={{ maxWidth: thumbSize, maxHeight: thumbSize * 1.4 }}
            loading="lazy"
          />
        </button>
      ) : (
        <button
          onClick={handleOpen}
          className="relative block rounded-2xl overflow-hidden bg-black hover:opacity-90 active:opacity-75 transition-opacity"
          style={{ width: thumbSize, height: thumbSize * 0.75 }}
        >
          <video
            ref={videoRef}
            src={`${resolvedUrl}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
              <Play className="w-6 h-6 text-black fill-black ml-0.5" />
            </div>
          </div>
          <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/60 rounded text-[10px] text-white font-medium">
            视频
          </div>
        </button>
      )}

      {/* 放大模态框 */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col"
          onClick={() => setOpen(false)}
        >
          {/* 顶部工具栏 */}
          <div className="flex items-center justify-between p-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{filename || (type === 'image' ? '图片' : '视频')}</p>
            </div>
            <div className="flex items-center gap-2">
              {type === 'image' && (
                <>
                  <button
                    onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                    className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="缩小"
                  >
                    <ZoomOut className="w-5 h-5" />
                  </button>
                  <span className="text-white/80 text-xs tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
                  <button
                    onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                    className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="放大"
                  >
                    <ZoomIn className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                    className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="旋转"
                  >
                    <RotateCw className="w-5 h-5" />
                  </button>
                </>
              )}
              <button
                onClick={handleDownload}
                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="下载"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="关闭"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* 媒体内容区 */}
          <div
            className="flex-1 min-h-0 flex items-center justify-center overflow-hidden p-4"
            onClick={() => setOpen(false)}
          >
            {type === 'image' ? (
              <img
                src={resolvedUrl}
                alt={filename || 'image'}
                className="max-w-full max-h-full object-contain transition-transform"
                style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
                onClick={(e) => e.stopPropagation()}
                draggable={false}
              />
            ) : (
              // 关键：用 key 强制每次重新创建 video 元素
              // 同时在关闭时（open=false）卸载 src，释放解码器
              <video
                key={openKey}
                src={resolvedUrl}
                controls
                autoPlay
                playsInline
                controlsList="nodownload"
                className="max-w-full max-h-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>

          <div className="text-center text-white/50 text-xs py-2 flex-shrink-0">
            点击任意位置关闭
          </div>
        </div>
      )}
    </>
  )
}
