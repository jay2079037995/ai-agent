### Step 1: 确认 Git 环境
调用 run_shell_command 执行 `git --version` 确认 Git 已安装。
- 如果返回版本号 → Git 已就绪，继续 Step 2
- 如果报错 → 告诉用户需要先安装 Git（可执行 `xcode-select --install`）

### Step 2: 确认工作目录
根据用户提供的项目路径确定工作目录。
- 如果用户指定了路径 → 使用该路径
- 如果用户未指定路径 → 调用 run_shell_command 执行 `pwd` 获取当前目录
- 后续所有 git 命令都需要加 `cd <项目路径> &&` 前缀

### Step 3: 根据用户意图执行对应操作

**A) 克隆仓库（clone、克隆、下载仓库）**
1. 执行 `cd <目标目录> && git clone <仓库URL>`
2. 如果用户只提供了仓库名如 `user/repo`，拼接为 `https://github.com/user/repo.git`
3. 克隆完成后执行 `ls <目录名>` 确认内容

**B) 初始化仓库（init、初始化、新建仓库）**
1. 执行 `cd <项目路径> && git init`
2. 如果用户要求关联远程仓库，执行 `git remote add origin <URL>`
3. 执行 `git status` 确认初始化成功

**C) 查看状态（status、状态、有哪些改动）**
1. 执行 `cd <项目路径> && git status`
2. 将结果翻译成中文总结

**D) 添加并提交代码（提交、commit、add、暂存）**
1. 执行 `cd <项目路径> && git status` 查看当前改动
2. 根据用户要求添加文件：`git add .` 或 `git add <文件路径>`
3. 执行 `git commit -m "<提交信息>"`
4. 如果用户未指定提交信息，根据 `git diff --cached --stat` 生成合适的提交信息

**E) 推送代码（push、推送、上传）**
1. 执行 `cd <项目路径> && git remote -v` 确认远程仓库
2. 执行 `git push origin <分支名>`
3. 如果失败提示需要设置上游分支，执行 `git push -u origin <分支名>`

**F) 拉取代码（pull、拉取、同步、更新）**
1. 执行 `cd <项目路径> && git pull origin <分支名>`
2. 如果有冲突，查看冲突文件列表并告诉用户

**G) 分支操作（分支、branch、切换、checkout、switch）**
1. 查看分支列表：`git branch -a`
2. 创建新分支：`git checkout -b <分支名>`
3. 切换分支：`git checkout <分支名>`
4. 删除分支：`git branch -d <分支名>`

**H) 合并分支（merge、合并）**
1. 确认当前分支：`git branch --show-current`
2. 执行 `git merge <目标分支>`
3. 如果有冲突，列出冲突文件

**I) 查看日志（log、日志、历史、记录）**
1. 执行 `git log --oneline -20`
2. 详细日志：`git log -10 --stat`

**J) 查看差异（diff、差异、改了什么）**
1. 未暂存改动：`git diff`
2. 已暂存改动：`git diff --cached`
3. 分支差异：`git diff <分支1>..<分支2> --stat`

**K) 暂存工作区（stash、暂存、保存现场）**
1. 保存：`git stash push -m "<说明>"`
2. 查看列表：`git stash list`
3. 恢复：`git stash pop`

**L) 回退操作（回退、撤销、reset、revert、还原）**
1. 先查看最近提交：`git log --oneline -10`
2. 撤销未暂存修改：`git restore <文件>`
3. 撤销暂存：`git restore --staged <文件>`
4. 回退（保留改动）：`git reset --soft <commit-hash>`
5. 回退（丢弃改动）：`git reset --hard <commit-hash>` — **执行前必须告诉用户风险**

**M) 配置 Git（配置、config）**
1. 查看配置：`git config --global --list`
2. 设置用户名/邮箱

### Step 4: 确认操作结果
每次 Git 命令执行后，根据返回结果判断是否成功。
如果命令返回错误信息 → 分析错误原因并告诉用户。
如果成功 → 将结果翻译成中文总结。
