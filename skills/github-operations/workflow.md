### Step 1: 打开 GitHub
调用 browser_action navigate 到 https://github.com/

### Step 2: 检查登录状态
调用 browser_action read 读取页面元素。
- 如果看到用户头像、"New"按钮、Dashboard 相关元素 → 已登录，跳到 Step 5
- 如果看到"Sign in"按钮 → 未登录，继续 Step 3

### Step 3: 点击登录
点击"Sign in"按钮，等待页面跳转到登录表单。
告诉用户："请在浏览器中输入你的 GitHub 账号密码登录"

### Step 4: 等待用户登录
调用 browser_action wait_for_page_change(timeout=120, interval=5) 等待用户完成登录。
- 如果登录成功 → 继续 Step 5
- 如果仍未登录 → 告诉用户"登录超时，请重试"

### Step 5: 根据用户意图执行对应操作

**A) 创建仓库（创建仓库、new repo、新建项目）**
1. navigate 到 https://github.com/new
2. 读取表单元素，找到 "Repository name" 输入框
3. 输入仓库名称（注意不要输入到 Description 框）
4. 如果用户要求私有仓库，切换 Public/Private
5. 如果用户要求初始化 README，勾选对应选项
6. 点击 "Create repository" 按钮

**B) 提交 Issue（提交 issue、创建 issue、报告问题）**
1. navigate 到 https://github.com/{owner}/{repo}/issues/new
2. 输入 Issue 标题和内容（使用 Markdown 格式）
3. 点击 "Submit new issue" 按钮

**C) Star 仓库（star、收藏、点赞）**
1. navigate 到目标仓库页面
2. 找到并点击 "Star" 按钮

**D) Fork 仓库（fork、复刻）**
1. navigate 到目标仓库页面
2. 点击 "Fork" 按钮
3. 确认 Fork 设置，点击 "Create fork"

**E) 查看/搜索仓库（搜索、查找、查看仓库）**
1. navigate 到 https://github.com/search?q={关键词}&type=repositories
2. 读取搜索结果并总结

### Step 6: 确认操作结果
每次操作完成后，读取结果页面并向用户确认。
如果操作失败，分析页面上的错误提示并告知用户。
