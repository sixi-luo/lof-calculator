# LOF基金折溢价计算器 PWA

实时计算LOF基金折溢价的Web应用，支持PWA安装到手机主屏幕。支持A股、港股、美股全市场行情查询。

## ✨ 功能特性

- **实时行情**：获取LOF基金实时行情价格
- **净值估算**：基于指数涨跌估算当日基金净值
- **折溢价计算**：计算基金价格与估算净值的折溢价率
- **历史数据**：查看近30天净值、价格、折溢价历史
- **全市场支持**：支持A股股票/指数、港股股票/指数、美股股票/指数
- **PWA支持**：可安装到手机主屏幕，像原生应用一样使用
- **分组管理**：自定义基金分组，批量查询
- **智能缓存**：减少API请求，提升加载速度

## 🚀 快速开始

### 前置要求

1. **Node.js** (版本 18.0.0 或更高)
   - 下载地址：https://nodejs.org/
   - 安装后验证：打开终端，运行 `node --version`

2. **Git** (用于版本控制)
   - 下载地址：https://git-scm.com/
   - 安装后验证：打开终端，运行 `git --version`

3. **GitHub 账户** (用于代码托管)
   - 注册地址：https://github.com/

4. **Vercel 账户** (用于免费部署)
   - 注册地址：https://vercel.com/

### 本地开发设置

#### 1. 克隆项目

```bash
# 克隆项目到本地
git clone https://github.com/你的用户名/lof-calculator.git
cd lof-calculator
```

> **Windows用户注意**：如果使用PowerShell，命令相同。如果遇到权限问题，请以管理员身份运行PowerShell。

#### 2. 安装依赖

```bash
# 安装项目所需的所有依赖包
npm install
```

这个过程可能需要几分钟，会下载所有必要的包到 `node_modules` 文件夹。

#### 3. 配置环境变量

1. 复制环境变量模板文件：
   ```bash
   # Windows (PowerShell)
   Copy-Item .env.local.example .env.local
   
   # Mac/Linux (Terminal)
   cp .env.local.example .env.local
   ```

2. 编辑 `.env.local` 文件，配置以下变量：

   ```bash
   # TickFlow API密钥 (必需)
   # 从 https://tickflow.org 注册并获取免费API密钥
   TICKFLOW_API_KEY=你的_tickflow_api_key_here
   
   # 缓存配置（可选，使用默认值即可）
   CACHE_QUOTE_TTL=30000      # 行情数据缓存30秒
   CACHE_NAV_TTL=300000       # 净值数据缓存5分钟
   CACHE_INDEX_TTL=30000      # 指数数据缓存30秒
   CACHE_KLINE_TTL=86400000   # K线数据缓存1天
   CACHE_BATCH_TTL=60000      # 批量数据缓存1分钟
   CACHE_HISTORY_TTL=86400000 # 历史数据缓存1天
   
   # 重试配置（可选）
   API_RETRY_ATTEMPTS=3       # API失败重试次数
   API_RETRY_DELAY=1000       # 重试延迟(毫秒)
   ```

   > **重要**：`.env.local` 文件包含敏感信息，**不要**上传到GitHub！

#### 4. 获取TickFlow API密钥

1. 访问 https://tickflow.org
2. 点击 "Sign Up" 注册账户
3. 登录后进入 Dashboard
4. 在 "API Keys" 部分生成新密钥
5. 复制密钥并粘贴到 `.env.local` 文件的 `TICKFLOW_API_KEY`

#### 5. 启动开发服务器

```bash
# 启动开发服务器，默认端口3000
npm run dev
```

打开浏览器访问：http://localhost:3000

如果看到LOF计算器界面，说明本地环境配置成功！

## 📱 使用指南

### 添加基金代码

1. 点击"新建分组"创建基金分组
2. 在文本框中输入基金代码（支持多种格式）：
   - A股LOF基金：`161725` (招商白酒LOF)
   - A股指数：`000300` (沪深300)
   - A股股票：`600519` (贵州茅台)
   - 港股股票：`00700.HK` (腾讯)
   - 美股股票：`AAPL.US` (苹果)
3. 点击"添加到分组"或按 `Ctrl+Enter`

### 查看折溢价

1. 添加基金代码后，点击"🔄 刷新数据"
2. 系统会自动获取：
   - 实时行情价格
   - 最新基金净值
   - 相关指数涨跌
   - 估算净值和折溢价
3. 折溢价为正表示溢价（价格 > 净值），为负表示折价

### 自定义配置

对于没有预置指数的LOF基金，可以自定义配置：

1. 点击基金行右侧的"⚙️"按钮
2. 设置跟踪的指数代码和系数
3. 支持手动输入涨跌幅（休市时使用）

### 手机安装(PWA)

1. 在手机Chrome浏览器中打开部署后的网址
2. 点击浏览器菜单(三个点)
3. 选择"添加到主屏幕"
4. 像原生应用一样使用

## 🚀 部署到GitHub

### 1. 创建GitHub仓库

1. 登录 https://github.com
2. 点击右上角"+" → "New repository"
3. 输入仓库名称：`lof-calculator`
4. 选择"Public"（公开）
5. 不要勾选"Initialize with README"（因为已有文件）
6. 点击"Create repository"

### 2. 推送代码到GitHub

在项目根目录执行以下命令：

```bash
# 初始化Git仓库（如果还没有）
git init

# 添加所有文件到暂存区
git add .

# 提交更改
git commit -m "Initial commit: LOF基金计算器"

# 添加GitHub远程仓库地址
# 注意：将 YOUR_USERNAME 替换为你的GitHub用户名
git remote add origin https://github.com/YOUR_USERNAME/lof-calculator.git

# 推送代码到GitHub
git branch -M main
git push -u origin main
```

> **注意**：Windows用户如果遇到行尾符警告，可以运行 `git config --global core.autocrlf true`

### 3. 验证上传

1. 刷新GitHub仓库页面
2. 应该看到所有项目文件
3. 确保 `.env.local` **没有**被上传（检查是否有该文件）

## 🌐 部署到Vercel（免费）

### 1. 连接GitHub仓库

1. 访问 https://vercel.com
2. 使用GitHub账户登录
3. 点击"Add New..." → "Project"
4. 从GitHub仓库列表中选择 `lof-calculator`
5. 点击"Import"

### 2. 配置环境变量

1. 在Vercel项目设置中，找到"Environment Variables"
2. 点击"Add New"
3. 添加以下环境变量（与本地 `.env.local` 相同）：
   - `TICKFLOW_API_KEY` = 你的API密钥
   - 其他缓存配置变量（可选）
4. 点击"Save"

### 3. 开始部署

1. 点击"Deploy"
2. 等待构建完成（约1-2分钟）
3. 部署成功后，会显示一个URL，如：`https://lof-calculator.vercel.app`

### 4. 配置自定义域名（可选）

1. 在Vercel项目设置中，找到"Domains"
2. 输入你的域名
3. 按照指引配置DNS

## 🔧 故障排除

### 常见问题

#### 1. `npm install` 失败
- **错误**：网络超时或权限不足
- **解决**：
  - 使用淘宝镜像：`npm config set registry https://registry.npmmirror.com`
  - 以管理员身份运行终端
  - 清除缓存：`npm cache clean --force`

#### 2. 无法获取数据
- **错误**：页面显示"数据获取失败"
- **解决**：
  - 检查 `.env.local` 中的 `TICKFLOW_API_KEY` 是否正确
  - 验证网络连接
  - 尝试点击"强制刷新"复选框

#### 3. 基金净值无法显示
- **错误**：净值显示为"暂无"
- **解决**：
  - 该基金可能非LOF基金
  - 检查基金代码是否正确
  - 东方财富API可能暂时不可用，稍后重试

#### 4. 部署到Vercel失败
- **错误**：构建失败
- **解决**：
  - 检查Vercel环境变量是否配置正确
  - 确保 `package.json` 中的依赖版本兼容
  - 查看Vercel构建日志中的具体错误

### 开发命令参考

```bash
# 开发模式（热重载）
npm run dev

# 生产构建
npm run build

# 启动生产服务器
npm run start

# 检查TypeScript类型错误
npx tsc --noEmit

# 清理构建缓存
rm -rf .next
```

## 📁 项目结构

```
lof-calculator/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API路由
│   │   │   ├── download/      # 数据下载
│   │   │   ├── lof/          # LOF数据接口
│   │   │   └── quote/        # 行情数据接口
│   │   ├── globals.css       # 全局样式
│   │   ├── layout.tsx        # 根布局
│   │   └── page.tsx          # 主页组件
│   ├── lib/                   # 工具库
│   │   └── lof-list.ts       # LOF基金列表
│   └── utils/                # 工具函数
│       ├── cache.ts          # 前端缓存
│       └── server-cache.ts   # 服务端缓存
├── public/                    # 静态资源
├── prisma/                    # 数据库配置
├── .env.local.example         # 环境变量模板
├── .gitignore                # Git忽略文件
├── next.config.ts            # Next.js配置
├── package.json              # 项目依赖
├── tailwind.config.ts        # Tailwind配置
└── tsconfig.json             # TypeScript配置
```

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

1. Fork本仓库
2. 创建功能分支：`git checkout -b feature/新功能`
3. 提交更改：`git commit -m '添加新功能'`
4. 推送到分支：`git push origin feature/新功能`
5. 提交Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## ⚠️ 免责声明

**重要**：本项目提供的所有数据仅供参考，不构成任何投资建议。基金投资有风险，入市需谨慎。开发者不对因使用本项目数据而产生的任何投资损失负责。

---

## 🎯 下一步

- [ ] 获取TickFlow API密钥
- [ ] 配置本地环境变量
- [ ] 运行 `npm run dev` 测试
- [ ] 创建GitHub仓库并推送代码
- [ ] 部署到Vercel
- [ ] 手机安装PWA

**祝您使用愉快！如有问题，欢迎在GitHub提交Issue。**