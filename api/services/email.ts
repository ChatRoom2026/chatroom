/**
 * 邮件发送服务
 * 使用 nodemailer 发送验证码邮件
 */
import nodemailer from 'nodemailer'

let transporter: nodemailer.Transporter | null = null

/**
 * 获取邮件配置（从 process.env 实时读取，避免模块加载时 env 未初始化）
 */
function getMailConfig() {
  return {
    host: process.env.MAIL_HOST || '',
    port: parseInt(process.env.MAIL_PORT || '587'),
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
    from: process.env.MAIL_FROM || process.env.MAIL_USER || '',
  }
}

/**
 * 初始化邮件发送器
 */
function getTransporter() {
  if (transporter) return transporter

  const config = getMailConfig()

  // 如果没有配置邮件，返回 null
  if (!config.host || !config.user || !config.pass) {
    return null
  }

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  })

  return transporter
}

/**
 * 发送验证码邮件
 * @param email 收件邮箱
 * @param code 验证码
 */
export async function sendVerificationEmail(email: string, code: string): Promise<boolean> {
  const transport = getTransporter()
  const config = getMailConfig()

  if (!transport) {
    console.log(`[邮件服务未配置] 验证码 ${code} 已发送到 ${email}（实际未发送）`)
    console.log(`提示：在 .env 中配置 MAIL_HOST/MAIL_USER/MAIL_PASS 即可启用邮件发送`)
    return false
  }

  try {
    await transport.sendMail({
      from: config.from,
      to: email,
      subject: 'ChatRoom 身份验证码',
      html: `
        <div style="max-width:600px;margin:0 auto;padding:20px;background:#1E293B;border-radius:12px;color:#fff;font-family:sans-serif">
          <div style="text-align:center;margin-bottom:20px">
            <h1 style="color:#60A5FA;margin:0">ChatRoom</h1>
            <p style="color:#94A3B8">身份验证</p>
          </div>
          <div style="background:#0F172A;padding:30px;border-radius:8px;text-align:center">
            <p style="font-size:14px;color:#94A3B8;margin-bottom:10px">您好，本次ChatRoom的身份验证码为</p>
            <div style="font-size:36px;font-weight:bold;color:#60A5FA;letter-spacing:8px;padding:15px 0">${code}</div>
            <p style="font-size:12px;color:#64748B;margin-top:20px">验证码有效期 10 分钟，请勿泄露给他人</p>
          </div>
        </div>
      `,
    })
    console.log(`验证码邮件已发送到 ${email}`)
    return true
  } catch (error) {
    console.error('发送邮件失败:', error)
    return false
  }
}