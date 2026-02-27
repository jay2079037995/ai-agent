### Step 1: 分析用户下载需求
根据用户描述判断下载类型：

**A) 直链下载** — 用户给了明确的 URL（如 .zip, .dmg, .tar.gz, .pdf, .png, .mp4 等）
→ 跳到 Step 3A

**B) 需要搜索下载链接** — 用户说了想下载什么软件/资源，但没给链接
→ 跳到 Step 2

**C) 需要从网页中提取资源** — 用户给了一个网页 URL，想下载其中的图片/文件/视频等
→ 跳到 Step 3C

**D) 批量下载** — 用户需要下载多个文件（如"下载这个目录下所有图片"）
→ 跳到 Step 3D

### Step 2: 搜索下载链接
1. 根据用户需求确定搜索关键词，调用 web_search 搜索
   - 软件下载：搜索 "<软件名> download mac" 或 "<软件名> 官网下载"
   - 资源下载：搜索 "<资源名> 下载" 或 "<资源名> download"
2. 从搜索结果中找到可靠的下载页面（优先官方网站）
3. 告诉用户找到的下载来源，并询问是否从该来源下载
4. 如果需要从网页中获取下载链接：
   - 调用 browser_action navigate 到下载页面
   - 调用 browser_action read 查看页面元素
   - 寻找下载按钮或链接（通常包含 "Download"、"下载"、".dmg"、".zip" 等文字）
   - 如果有多个版本（如 macOS/Windows/Linux），选择 macOS 版本
   - 获取到直接下载链接后跳到 Step 3A

### Step 3: 执行下载

**A) 直链文件下载**
1. 确定保存目录，默认使用用户的 Downloads 目录：`~/Downloads`
2. 确定文件名：从 URL 末尾提取，或使用 `-J`（curl 自动取名）
3. 执行下载命令：
   ```
   run_shell_command: curl -L -o ~/Downloads/<文件名> "<URL>" --progress-bar 2>&1
   ```
4. 下载完成后验证：执行 `ls -lh ~/Downloads/<文件名>` 确认文件存在和大小
5. 告诉用户下载完成，文件保存位置和大小

**B) Git 仓库克隆下载**
如果用户要下载的是 GitHub/GitLab 仓库：
1. 执行 `cd ~/Downloads && git clone <仓库URL>`
2. 克隆完成后执行 `ls -la ~/Downloads/<仓库名>` 确认内容

**C) 从网页提取并下载资源**
1. 调用 browser_action navigate 到目标网页
2. 调用 browser_action read 查看页面元素
3. 根据用户需求识别要下载的资源
4. 获取到资源 URL 后，按照 Step 3A 的方法下载

**D) 批量下载**
1. 首先获取所有需要下载的 URL 列表
2. 创建下载目录：`mkdir -p ~/Downloads/<任务名>`
3. 逐个下载或使用 shell 循环
4. 完成后执行 `ls -lh ~/Downloads/<任务名>/` 查看下载结果

### Step 4: 特殊场景处理

**需要登录/认证才能下载**
1. 使用 browser_action navigate 到下载页面
2. 提示用户在浏览器中登录
3. 调用 browser_action wait_for_page_change 等待用户完成登录
4. 登录后点击下载按钮

**下载失败排查**
如果 curl 下载失败：
1. 检查 URL（执行 `curl -I "<URL>"` 查看 HTTP 头信息）
2. 403 Forbidden → 添加 User-Agent 头重试
3. 超时 → 增加 `--connect-timeout 30 --max-time 600`
4. 仍然失败 → 尝试使用 browser_action 在浏览器中打开下载链接

**下载后自动处理**
- .zip / .tar.gz → 询问用户是否需要解压
- .dmg → 告诉用户可以双击安装
- 图片 → 执行 `open` 预览

### Step 5: 确认下载结果
1. 执行 `ls -lh <下载路径>` 确认文件存在
2. 告诉用户文件保存位置、大小和文件清单
