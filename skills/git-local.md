# Git 本地操作

## Meta
- match: git, 提交, commit, push, pull, 推送, 拉取, 分支, branch, merge, 合并, clone, 克隆, 初始化, git init, 暂存, stash, 回退, reset, checkout, diff, log, 代码管理, 版本控制
- description: 在 macOS 上执行 Git 本地操作，包括初始化仓库、提交代码、推送拉取、分支管理、查看日志等

## Steps

### Step 1: 确认 Git 环境
调用 run_shell_command 执行 `git --version` 确认 Git 已安装。
- 如果返回版本号 → Git 已就绪，继续 Step 2
- 如果报错 → 告诉用户需要先安装 Git（可执行 `xcode-select --install`）

### Step 2: 确认工作目录
根据用户提供的项目路径确定工作目录。
- 如果用户指定了路径 → 使用该路径
- 如果用户未指定路径 → 调用 run_shell_command 执行 `pwd` 获取当前目录，并询问用户是否在此目录操作
- 后续所有 git 命令都需要加 `cd <项目路径> &&` 前缀，确保在正确的目录下执行

### Step 3: 根据用户意图执行对应操作

**A) 克隆仓库（用户提到：clone、克隆、下载仓库）**
1. 调用 run_shell_command 执行 `cd <目标目录> && git clone <仓库URL>`
2. 如果用户提供了 SSH 地址（git@github.com:...）直接使用
3. 如果用户只提供了仓库名如 `user/repo`，拼接为 `https://github.com/user/repo.git`
4. 克隆完成后执行 `ls <目录名>` 确认内容

**B) 初始化仓库（用户提到：init、初始化、新建仓库）**
1. 调用 run_shell_command 执行 `cd <项目路径> && git init`
2. 如果用户要求关联远程仓库，执行 `git remote add origin <URL>`
3. 执行 `git status` 确认初始化成功

**C) 查看状态（用户提到：status、状态、有哪些改动）**
1. 调用 run_shell_command 执行 `cd <项目路径> && git status`
2. 将结果翻译成中文总结告诉用户：哪些文件修改了、哪些未跟踪、哪些已暂存

**D) 添加并提交代码（用户提到：提交、commit、add、暂存）**
1. 调用 run_shell_command 执行 `cd <项目路径> && git status` 查看当前改动
2. 根据用户要求决定添加范围：
   - 添加全部：`git add .` 或 `git add -A`
   - 添加指定文件：`git add <文件路径>`
3. 执行 `git status` 确认暂存区内容
4. 执行 `git commit -m "<提交信息>"`
   - 如果用户指定了提交信息，使用用户提供的
   - 如果用户未指定，根据 `git diff --cached --stat` 的结果生成合适的提交信息
5. 告诉用户提交成功，显示 commit hash

**E) 推送代码（用户提到：push、推送、上传）**
1. 调用 run_shell_command 执行 `cd <项目路径> && git remote -v` 确认远程仓库
2. 执行 `git branch --show-current` 获取当前分支名
3. 执行 `git push origin <分支名>`
4. 如果推送失败提示需要设置上游分支，执行 `git push -u origin <分支名>`
5. 如果推送失败提示需要先 pull，告诉用户并询问是否先拉取

**F) 拉取代码（用户提到：pull、拉取、同步、更新）**
1. 调用 run_shell_command 执行 `cd <项目路径> && git pull origin <分支名>`
2. 如果有冲突，执行 `git status` 查看冲突文件列表，告诉用户哪些文件有冲突需要手动解决

**G) 分支操作（用户提到：分支、branch、切换、checkout、switch）**
1. 查看分支列表：`cd <项目路径> && git branch -a`
2. 创建新分支：`git branch <分支名>` 或 `git checkout -b <分支名>`
3. 切换分支：`git checkout <分支名>` 或 `git switch <分支名>`
4. 删除分支：`git branch -d <分支名>`（安全删除）
5. 每次操作后执行 `git branch` 确认当前分支

**H) 合并分支（用户提到：merge、合并）**
1. 执行 `cd <项目路径> && git branch --show-current` 确认当前分支
2. 执行 `git merge <目标分支>`
3. 如果有冲突，执行 `git status` 列出冲突文件，告诉用户需要手动解决
4. 合并成功后告诉用户结果

**I) 查看日志（用户提到：log、日志、历史、记录）**
1. 调用 run_shell_command 执行 `cd <项目路径> && git log --oneline -20`
2. 如果用户要看详细日志：`git log -10 --stat`
3. 如果用户要看某个文件的历史：`git log --oneline -10 -- <文件名>`
4. 将结果整理后告诉用户

**J) 查看差异（用户提到：diff、差异、改了什么）**
1. 查看未暂存的改动：`cd <项目路径> && git diff`
2. 查看已暂存的改动：`git diff --cached`
3. 查看两个分支的差异：`git diff <分支1>..<分支2> --stat`
4. 将关键改动总结告诉用户

**K) 暂存工作区（用户提到：stash、暂存、保存现场）**
1. 保存：`cd <项目路径> && git stash push -m "<说明>"`
2. 查看列表：`git stash list`
3. 恢复：`git stash pop` 或 `git stash apply stash@{N}`
4. 告诉用户操作结果

**L) 回退操作（用户提到：回退、撤销、reset、revert、还原）**
1. 先执行 `cd <项目路径> && git log --oneline -10` 查看最近提交
2. 撤销未暂存的修改：`git checkout -- <文件>` 或 `git restore <文件>`
3. 撤销暂存：`git reset HEAD <文件>` 或 `git restore --staged <文件>`
4. 回退到某个 commit（保留改动）：`git reset --soft <commit-hash>`
5. 回退到某个 commit（丢弃改动）：`git reset --hard <commit-hash>`
   **注意：--hard 会丢弃改动，执行前必须告诉用户风险并确认**

**M) 配置 Git（用户提到：配置、config、用户名、邮箱）**
1. 查看配置：`git config --global --list`
2. 设置用户名：`git config --global user.name "<名字>"`
3. 设置邮箱：`git config --global user.email "<邮箱>"`

### Step 4: 确认操作结果
每次 Git 命令执行后，根据返回结果判断是否成功。
- 如果命令返回错误信息 → 分析错误原因，尝试修复或告诉用户解决方法
- 如果成功 → 将结果翻译成用户能理解的中文总结
