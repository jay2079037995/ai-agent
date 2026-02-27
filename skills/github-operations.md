# GitHub 操作

## Meta
- match: github, repo, 仓库, 创建仓库, new repo, issue, pull request, pr, star, fork, clone, 提交issue, 创建issue
- description: 在 GitHub 上执行常见操作，包括创建仓库、提交 Issue、创建 Pull Request、Star/Fork 等，自动处理登录流程

## Steps

### Step 1: 打开 GitHub
调用 browser_action navigate 到 https://github.com/

### Step 2: 检查登录状态
调用 browser_action read 读取页面元素。
- 如果看到用户头像、"New"按钮、"Your repositories"、Dashboard 相关元素 → 已登录，跳到 Step 5
- 如果看到"Sign in"或"Sign up"按钮 → 未登录，继续 Step 3

### Step 3: 点击登录
点击"Sign in"按钮，等待页面跳转到登录表单。
调用 browser_action read 查看登录页面元素。
如果页面有用户名/邮箱和密码输入框 → 告诉用户："请在浏览器中输入你的 GitHub 账号密码登录，或使用其他登录方式"
如果有 SSO/OAuth 登录按钮 → 也提示用户可以选择对应方式

### Step 4: 等待用户登录
调用 browser_action wait_for_page_change(timeout=120, interval=5) 等待用户完成登录。
等待结束后，调用 browser_action read 再次检查登录状态。
- 如果登录成功（页面跳转到 Dashboard 或看到用户头像） → 继续 Step 5
- 如果仍未登录 → 告诉用户"登录超时，请重试"，结束流程

### Step 5: 根据用户意图执行对应操作
根据用户的具体请求，选择以下子流程之一：

**A) 创建仓库（用户提到：创建仓库、new repo、新建项目）**
1. 调用 browser_action navigate 到 https://github.com/new
2. 调用 browser_action read 读取表单元素，仔细阅读元素列表
3. **输入仓库名称（最关键的一步）**：
   - 页面上有多个 input 输入框，你必须准确区分它们
   - "Repository name" 输入框的特征：placeholder 通常包含 "repository" 或 "name" 字样，aria-label 包含 "Repository" 字样，它出现在 "Owner" 下拉框之后、"Description" 之前
   - "Description" 输入框的特征：placeholder 通常包含 "description" 字样，它出现在 "Repository name" 之后
   - **绝对不要把仓库名称输入到 Description 框里！** 先仔细确认 input 的 placeholder 或 aria-label 再输入
   - 使用 browser_action type 在 "Repository name" 对应的元素索引中输入仓库名称
4. 如果用户指定了描述，找到包含 "description" 的 input 输入框，输入描述文字
5. **切换为 Private（如果用户要求私有仓库）**：
   - 页面上的可见性选择可能是 radio 按钮或按钮组
   - 仔细查看元素列表中与 "Public" 和 "Private" 相关的元素
   - 如果看到独立的 "Private" radio 按钮或带 "Private" 文字的按钮 → 直接点击它
   - 如果看到一个可见性切换按钮（如显示 "Public" 的按钮） → 点击后会弹出下拉选项，此时必须再次调用 browser_action read 读取新出现的选项列表，然后找到 "Private" 选项并点击它
   - 点击后再调用 browser_action read 确认已切换为 Private
6. 如果用户要求初始化 README，找到 "Add a README file" 复选框并点击
7. 如果用户指定了 .gitignore 模板或 License，选择对应选项
8. 向下滚动页面（browser_action scroll down），找到并点击 "Create repository" 按钮
9. 等待页面跳转，告诉用户仓库创建成功并附上仓库链接

**B) 提交 Issue（用户提到：提交 issue、创建 issue、报告问题）**
1. 调用 browser_action navigate 到目标仓库的 Issues 页面：https://github.com/{owner}/{repo}/issues/new
   如果用户没有指定仓库，先询问仓库地址
2. 调用 browser_action read 读取表单元素
3. 在"Title"输入框中输入 Issue 标题
4. 在正文编辑区域（textarea）中输入 Issue 内容，使用 Markdown 格式
5. 如果用户要求添加 Labels，点击右侧"Labels"选择对应标签
6. 点击"Submit new issue"按钮
7. 等待页面跳转，告诉用户 Issue 已创建成功并附上链接

**C) Star 仓库（用户提到：star、收藏、点赞）**
1. 调用 browser_action navigate 到目标仓库页面：https://github.com/{owner}/{repo}
2. 调用 browser_action read 查找"Star"按钮
3. 如果看到"Star"按钮（未 Star 状态），点击它
4. 如果看到"Unstar"或"Starred"，告诉用户该仓库已经 Star 过了
5. 告诉用户操作结果

**D) Fork 仓库（用户提到：fork、复刻）**
1. 调用 browser_action navigate 到目标仓库页面：https://github.com/{owner}/{repo}
2. 调用 browser_action read 查找"Fork"按钮
3. 点击"Fork"按钮
4. 如果弹出 Fork 设置页面，调用 browser_action read 查看选项
5. 确认 Fork 目标账户，点击"Create fork"按钮
6. 等待页面跳转，告诉用户 Fork 成功并附上新仓库链接

**E) 查看/搜索仓库（用户提到：搜索、查找、查看仓库）**
1. 如果用户给出了具体仓库，调用 browser_action navigate 到 https://github.com/{owner}/{repo}
2. 如果用户要求搜索，调用 browser_action navigate 到 https://github.com/search?q={关键词}&type=repositories
3. 调用 browser_action read 读取页面内容
4. 将搜索结果或仓库信息总结告诉用户

**F) 其他操作**
如果用户的请求不属于以上类别，根据 GitHub 页面的实际元素，灵活使用 browser_action 的 navigate、click、type 等操作完成用户需求。始终先 read 页面再操作。

### Step 6: 确认操作结果
每次操作完成后，调用 browser_action read 读取结果页面。
向用户确认操作是否成功，附上相关链接。
如果操作失败，分析页面上的错误提示并告知用户原因。
