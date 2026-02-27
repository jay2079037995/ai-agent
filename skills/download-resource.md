# 下载资源

## Meta
- match: 下载, download, 保存, save, 获取文件, 抓取, fetch, wget, curl, 视频下载, 图片下载, 文件下载, 音乐下载, 安装包, dmg, zip, 压缩包, 网页保存, youtube, bilibili, 资源下载
- description: 从网络下载各类资源，包括文件、图片、视频、音乐、安装包等，支持直链下载、网页提取下载链接、批量下载

## Steps

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
   - 如果用户指定了保存路径，使用用户指定的路径
2. 确定文件名：
   - 如果 URL 末尾包含文件名（如 `https://example.com/file.zip`），使用该文件名
   - 如果 URL 不包含明显文件名，使用 `-J`（curl 自动取名）或手动指定文件名
3. 执行下载命令：
   ```
   run_shell_command: curl -L -o ~/Downloads/<文件名> "<URL>" --progress-bar 2>&1
   ```
   参数说明：
   - `-L`：自动跟随重定向（很多下载链接会 302 跳转）
   - `-o`：指定输出文件路径
   - `--progress-bar`：显示进度条
   - 如果文件较大（超过 100MB），增加超时：添加 `--max-time 600` 或更长
   - 如果服务器需要特定 Header，添加 `-H "User-Agent: Mozilla/5.0"`
4. 下载完成后验证：
   - 执行 `ls -lh ~/Downloads/<文件名>` 确认文件存在和大小
   - 如果文件大小为 0 或非常小（可能下载失败），告诉用户并尝试分析原因
5. 告诉用户下载完成，文件保存位置和大小

**B) Git 仓库克隆下载**
如果用户要下载的是 GitHub/GitLab 仓库：
1. 执行 `cd ~/Downloads && git clone <仓库URL>`
2. 克隆完成后执行 `ls -la ~/Downloads/<仓库名>` 确认内容
3. 告诉用户克隆完成

**C) 从网页提取并下载资源**
1. 调用 browser_action navigate 到目标网页
2. 调用 browser_action read 查看页面元素
3. 根据用户需求识别要下载的资源：
   - 如果是下载页面上的文件链接 → 找到 Download 按钮/链接的 URL
   - 如果需要提取页面中的图片 → 使用 run_shell_command 执行 curl 获取页面 HTML，提取 img 标签中的 src 地址
   - 如果需要下载页面上的附件/文档 → 找到对应链接
4. 获取到资源 URL 后，按照 Step 3A 的方法下载

**D) 批量下载**
1. 首先获取所有需要下载的 URL 列表
   - 如果用户提供了 URL 列表 → 直接使用
   - 如果需要从网页提取 → 先通过 browser_action 或 curl + 解析获取 URL 列表
2. 创建下载目录：
   ```
   run_shell_command: mkdir -p ~/Downloads/<任务名>
   ```
3. 逐个下载或使用 xargs 并发下载：
   - 少量文件（≤5 个）：逐个用 curl 下载
   - 多个文件：使用 shell 循环
   ```
   run_shell_command: cd ~/Downloads/<任务名> && for url in <url1> <url2> <url3>; do curl -L -O "$url"; done
   ```
4. 完成后执行 `ls -lh ~/Downloads/<任务名>/` 查看下载结果
5. 告诉用户下载完成，文件列表和总大小

### Step 4: 特殊场景处理

**需要登录/认证才能下载**
1. 使用 browser_action navigate 到下载页面
2. 如果需要登录，提示用户在浏览器中登录
3. 调用 browser_action wait_for_page_change 等待用户完成登录
4. 登录后点击下载按钮，浏览器会自动处理下载

**下载失败排查**
如果 curl 下载失败：
1. 检查 URL 是否正确（执行 `curl -I "<URL>"` 查看 HTTP 头信息）
2. 如果返回 403 Forbidden → 添加 User-Agent 头重试：
   ```
   curl -L -o <文件> -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "<URL>"
   ```
3. 如果返回 302 但没跟随重定向 → 确认已加 `-L` 参数
4. 如果超时 → 增加 `--connect-timeout 30 --max-time 600`
5. 如果是 HTTPS 证书问题 → 谨慎使用 `-k` 参数（告知用户风险）
6. 如果仍然失败 → 尝试使用 browser_action 在浏览器中打开下载链接，让浏览器处理下载

**下载后自动处理**
- 如果下载的是 .zip / .tar.gz → 询问用户是否需要解压
  - 解压 zip：`unzip ~/Downloads/<文件> -d ~/Downloads/<目录>`
  - 解压 tar.gz：`tar -xzf ~/Downloads/<文件> -C ~/Downloads/<目录>`
- 如果下载的是 .dmg → 告诉用户可以双击安装，或执行 `open ~/Downloads/<文件>` 挂载
- 如果下载的是图片 → 执行 `open ~/Downloads/<文件>` 预览

### Step 5: 确认下载结果
1. 执行 `ls -lh <下载路径>` 确认文件存在
2. 告诉用户：
   - 文件保存位置（完整路径）
   - 文件大小
   - 如果有多个文件，列出文件清单
3. 如果下载失败，分析原因并建议用户其他下载方式
