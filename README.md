# Lumina Studio

AI 图像生成工作室 - 使用 OpenAI 兼容 API 生成精美图像

## 功能特点

- 🎨 AI 图像生成
- 📐 多种宽高比支持 (1:1, 4:3, 3:4, 16:9, 9:16)
- 🖼️ 产品图片和风格参考上传
- ✨ 多种风格预设
- 💾 图像保存和下载
- 🔄 图像迭代优化

## 部署到 Vercel

### 方法一：一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=YOUR_REPO_URL)

### 方法二：手动部署

1. Fork 或克隆此仓库
2. 在 Vercel 中导入项目
3. 设置环境变量：
   - `OPENAI_BASE_URL`: API 基础地址
   - `OPENAI_API_KEY`: API 密钥
4. 点击部署

## 本地开发

```bash
# 安装依赖
npm install

# 创建环境变量文件
cp .env.example .env

# 编辑 .env 文件，填入你的 API 配置

# 启动开发服务器
npm run dev
```

## 环境变量

| 变量名 | 说明 |
|--------|------|
| `OPENAI_BASE_URL` | OpenAI 兼容 API 的基础 URL |
| `OPENAI_API_KEY` | API 密钥 |

## 技术栈

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Motion (Framer Motion)
- OpenAI SDK

## 许可证

MIT
