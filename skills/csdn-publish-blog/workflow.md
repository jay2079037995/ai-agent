### Step 1: 打开 CSDN
调用 browser_action navigate 到 https://www.csdn.net/

### Step 2: 检查登录状态
调用 browser_action read 读取页面元素。
- 如果看到"写博客"或"创作中心"或用户头像相关元素 → 已登录，跳到 Step 5
- 如果看到"登录"按钮 → 未登录，继续 Step 3

### Step 3: 点击登录
点击"登录"按钮，等待页面加载。
页面会显示二维码登录界面。
告诉用户："请在浏览器中使用 CSDN APP 或微信扫描二维码登录"

### Step 4: 等待扫码登录
调用 browser_action wait_for_page_change(timeout=120, interval=5) 等待用户扫码。
等待结束后，调用 browser_action read 再次检查登录状态。
- 如果登录成功（看到用户头像或"写博客"） → 继续 Step 5
- 如果仍未登录 → 告诉用户"登录超时，请重试"，结束流程

### Step 5: 进入博客编辑器
调用 browser_action navigate 到 https://editor.csdn.net/md/
等待编辑器加载完成（约 3 秒后调用 browser_action read）。

### Step 6: 编写文章
根据用户的需求生成文章标题和内容。
在标题输入框（页面顶部的 input 框，通常索引较小）中输入标题。
在 Markdown 编辑区域（通常是左侧的大文本区域/textarea）中输入文章内容。
内容使用 Markdown 格式编写，包含标题、段落、代码块等。

### Step 7: 发布文章
点击页面右上角的"发布"按钮。
如果弹出发布设置窗口，选择合适的分类和标签。
点击确认发布。
告诉用户文章已发布成功，并附上文章链接（如果能获取到）。
