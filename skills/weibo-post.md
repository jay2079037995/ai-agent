# 微博发帖

## Meta
- match: 微博, weibo, 发微博, 发帖, 发动态
- description: 在微博上发布动态/帖子，自动处理登录流程

## Steps

### Step 1: 打开微博
调用 browser_action navigate 到 https://weibo.com/

### Step 2: 检查登录状态
调用 browser_action read 读取页面元素。
- 如果看到"发微博"或用户昵称或"首页"导航 → 已登录，跳到 Step 5
- 如果看到"登录"或跳转到了登录页面 → 未登录，继续 Step 3

### Step 3: 登录
如果在登录页面，查找二维码登录选项。
告诉用户："请在浏览器中使用微博 APP 扫描二维码登录"

### Step 4: 等待扫码登录
调用 browser_action wait_for_page_change(timeout=120, interval=5) 等待用户扫码。
等待结束后，调用 browser_action read 再次检查。
- 如果登录成功 → 继续 Step 5
- 如果仍未登录 → 告诉用户"登录超时，请重试"，结束流程

### Step 5: 打开发帖界面
找到"发微博"按钮或文本输入区域。
如果在首页，通常顶部有发帖文本框。
点击文本输入区域使其获得焦点。

### Step 6: 编写内容
根据用户的需求生成帖子内容。
在文本输入区域中输入内容。
如果用户要求添加话题，使用 # 话题名 # 格式。

### Step 7: 发布
找到"发布"或"发送"按钮并点击。
确认发布成功后告诉用户。
