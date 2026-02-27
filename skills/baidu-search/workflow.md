### Step 1: 打开百度
调用 browser_action navigate 到 https://www.baidu.com/

### Step 2: 输入搜索内容
在页面元素列表中找到搜索输入框（通常是 input 类型，placeholder 包含"百度一下"或"请输入"）。
使用 browser_action type 在搜索框中输入用户要搜索的关键词。

### Step 3: 执行搜索
使用 browser_action key_press 按下 Enter 键提交搜索。
或者找到"百度一下"按钮，使用 browser_action click 点击。
等待搜索结果加载。

### Step 4: 查看结果
调用 browser_action read 读取搜索结果页面的元素。
将搜索结果总结告诉用户。
如果用户需要点击某个结果，使用 browser_action click 点击对应链接。
