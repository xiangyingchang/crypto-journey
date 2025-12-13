# 部署到 GitHub Pages 指南

## 快速部署步骤

### 1. 创建 GitHub 仓库

1. 登录 [GitHub](https://github.com)
2. 点击右上角 **+** → **New repository**
3. 仓库名称：`finance-tracker`（或其他名称）
4. 选择 **Public**（GitHub Pages 免费版需要公开仓库）
5. 点击 **Create repository**

### 2. 上传代码

```bash
cd /Users/muskxiang/CodeBuddy/20251209212825
git init
git add .
git commit -m "Initial commit: Finance Tracker"
git branch -M main
git remote add origin https://github.com/你的用户名/finance-tracker.git
git push -u origin main
```

### 3. 启用 GitHub Pages

1. 进入仓库 **Settings**
2. 左侧菜单选择 **Pages**
3. Source 选择 **Deploy from a branch**
4. Branch 选择 **main**，文件夹选择 **/ (root)**
5. 点击 **Save**
6. 等待几分钟，访问：`https://你的用户名.github.io/finance-tracker/`

## 云端同步配置（安全方案）

### 工作原理

- 使用 **GitHub Gist**（私密代码片段）存储数据
- Token 和 Gist ID **仅保存在浏览器本地**，不会出现在代码中
- Token 只需要 **gist 权限**，不能访问你的仓库

### 配置步骤

1. 打开网站，点击 **☁️ 云端设置**
2. 点击 **获取Token** 链接，创建只有 gist 权限的 Token
3. 将 Token 粘贴到输入框
4. 点击 **创建新Gist**（或输入已有 Gist ID）
5. 点击 **保存**

配置完成后，每次添加记录会自动同步到 Gist。

### 多设备同步

在新设备上：
1. 打开网站
2. 点击 **☁️ 云端设置**
3. 输入相同的 Token 和 Gist ID
4. 刷新页面，数据自动加载

## 安全说明

| 项目 | 安全性 |
|------|--------|
| Token 存储位置 | 浏览器 localStorage（仅本地） |
| Token 权限 | 仅 gist（不能访问仓库） |
| Gist 类型 | 私密（只有你能看到） |
| 代码中是否包含敏感信息 | 否 |

⚠️ **注意**：如果清除浏览器数据，需要重新配置 Token。

## 数据备份

- 使用"导出数据"功能下载 JSON 文件
- 使用"导入数据"功能恢复数据
