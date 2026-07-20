/**
 * 面部特征提取 —— face-api.js (TinyFace + FaceNet)
 * 使用深度学习模型进行人脸检测和 128 维嵌入向量提取
 * 精度：LFW 数据集 99%+（FaceNet 模型）
 * 不可用时降级为 FaceDetector API + 传统灰度采样
 */

import * as faceapi from '@vladmandic/face-api'

// ============ 模型加载状态 ============

export type ModelStatus = 'idle' | 'loading' | 'loaded' | 'error'

let modelsLoaded = false
let modelsLoading = false
let modelStatus: ModelStatus = 'idle'
let loadPromise: Promise<boolean> | null = null
const statusListeners = new Set<(status: ModelStatus) => void>()

export function getModelStatus(): ModelStatus {
  return modelStatus
}

export function onModelStatusChange(fn: (status: ModelStatus) => void): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

function setModelStatus(status: ModelStatus) {
  modelStatus = status
  statusListeners.forEach(fn => fn(status))
}

/**
 * 加载 face-api.js 模型（TinyFace 检测 + FaceNet 识别）
 * 只需要加载一次，后续调用复用
 */
async function loadModels(): Promise<boolean> {
  if (modelsLoaded) return true
  if (modelsLoading && loadPromise) return loadPromise

  modelsLoading = true
  setModelStatus('loading')
  loadPromise = (async () => {
    try {
      const MODEL_URL = '/models'

      // 并行加载检测和识别模型
      await Promise.all([
        faceapi.nets.tinyFaceDetector.load(MODEL_URL),
        faceapi.nets.faceRecognitionNet.load(MODEL_URL),
      ])

      modelsLoaded = true
      setModelStatus('loaded')
      console.log('[face] 模型加载成功：TinyFace + FaceNet')
      return true
    } catch (err) {
      console.warn('[face] 模型加载失败，降级为传统方法:', err)
      setModelStatus('error')
      return false
    } finally {
      modelsLoading = false
    }
  })()

  return loadPromise
}

// ============ 类型声明（FaceDetector API 降级） ============

interface DetectedFace {
  boundingBox: DOMRectReadOnly
  landmarks?: Array<{ locations: Array<{ x: number; y: number }>; type: string }>
}

interface FaceDetectorConstructor {
  new (options?: { fastMode?: boolean; maxDetectedFaces?: number }): {
    detect: (image: ImageBitmapSource) => Promise<DetectedFace[]>
  }
}

declare global {
  interface Window {
    FaceDetector?: FaceDetectorConstructor
  }
}

// ============ 降级：FaceDetector API 检测 ============

async function detectFaceBrowser(canvas: HTMLCanvasElement): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if (!window.FaceDetector) return null
  try {
    const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 })
    const bitmap = await createImageBitmap(canvas)
    const faces = await detector.detect(bitmap)
    bitmap.close()
    if (faces.length === 0) return null
    const box = faces[0].boundingBox
    const padX = box.width * 0.15
    const padY = box.height * 0.15
    return {
      x: Math.max(0, box.x - padX),
      y: Math.max(0, box.y - padY),
      width: Math.min(canvas.width - box.x + padX, box.width + padX * 2),
      height: Math.min(canvas.height - box.y + padY, box.height + padY * 2),
    }
  } catch {
    return null
  }
}

// ============ 降级：64 维灰度特征（传统方法） ============

function extractFromRegion(
  imageData: ImageData,
  region: { x: number; y: number; width: number; height: number },
  canvasWidth: number
): number[] {
  const data = imageData.data
  const blockSize = Math.max(1, Math.floor(Math.min(region.width, region.height) / 8))
  const feats: number[] = []
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      let sum = 0, count = 0
      for (let ry = 0; ry < blockSize; ry++) {
        for (let rx = 0; rx < blockSize; rx++) {
          const px = Math.floor(region.x + bx * blockSize + rx)
          const py = Math.floor(region.y + by * blockSize + ry)
          if (px >= canvasWidth || py >= imageData.height) continue
          const idx = (py * canvasWidth + px) * 4
          if (idx + 2 >= data.length) continue
          sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
          count++
        }
      }
      feats.push(count > 0 ? sum / count / 255 : 0)
    }
  }
  let norm = 0
  for (let i = 0; i < feats.length; i++) norm += feats[i] * feats[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < feats.length; i++) feats[i] = Math.round((feats[i] / norm) * 10000) / 10000
  return feats
}

function extractFromCenter(imageData: ImageData, canvasWidth: number, canvasHeight: number): number[] {
  const sx = Math.floor(canvasWidth * 0.2)
  const sy = Math.floor(canvasHeight * 0.2)
  const sw = canvasWidth - 2 * sx
  const sh = canvasHeight - 2 * sy
  return extractFromRegion(imageData, { x: sx, y: sy, width: sw, height: sh }, canvasWidth)
}

// ============ 主入口 ============

export interface FaceResult {
  /** 128 维（FaceNet 模式）或 64 维（降级模式）特征向量 */
  descriptor: number[]
  /** 是否使用了深度学习模型 */
  precise: boolean
}

/**
 * 从 video 采集人脸特征
 * 优先使用 face-api.js (TinyFace + FaceNet) 输出 128 维嵌入向量
 * 不可用时降级为 FaceDetector API + 传统灰度采样
 *
 * @param video 视频元素
 * @param canvas 画布元素（会被调整大小）
 * @param size 内部处理分辨率（默认 224，FaceNet 推荐输入尺寸）
 * @returns FaceResult
 */
export async function captureFaceDescriptor(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  size: number = 224
): Promise<FaceResult> {
  const empty: FaceResult = { descriptor: [], precise: false }

  // 1. 尝试加载模型
  const modelReady = await loadModels()

  // 2. 绘制视频帧到 canvas
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return empty

  // 镜像翻转
  ctx.translate(canvas.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  // 3. 深度学习模式：face-api.js
  if (modelReady) {
    try {
      const result = await faceapi
        .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 128, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor()

      if (result && result.descriptor) {
        // FaceNet 输出 Float32Array(128)，转为普通 number[]
        const descriptor = Array.from(result.descriptor).map((v) => Math.round(v * 100000) / 100000)
        return { descriptor, precise: true }
      }
      // 未检测到人脸，返回空
      return empty
    } catch (err) {
      console.warn('[face] face-api 检测失败，降级:', err)
      // 继续降级
    }
  }

  // 4. 降级模式：FaceDetector API + 64 维灰度
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const faceBox = await detectFaceBrowser(canvas)
  if (faceBox) {
    const descriptor = extractFromRegion(imageData, faceBox, canvas.width)
    return { descriptor, precise: false }
  }
  const descriptor = extractFromCenter(imageData, canvas.width, canvas.height)
  return { descriptor, precise: false }
}

/**
 * 检查是否支持人脸识别（face-api 已加载或 FaceDetector 可用）
 */
export function supportsFaceDetector(): boolean {
  if (typeof window === 'undefined') return false
  return modelsLoaded || !!window.FaceDetector
}

/**
 * 预加载模型（可在应用启动时调用）
 */
export function preloadModels(): void {
  loadModels()
}