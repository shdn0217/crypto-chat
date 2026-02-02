# 端到端加密聊天室（密码学作业）

## 功能
- **端到端加密**：浏览器端 PBKDF2 派生密钥 + AES-256-GCM 加密/解密
- **消息完整性验证**：AES-GCM 解密时自动校验认证标签（篡改/口令不一致会失败）
- **加密状态显示**：每条消息显示 **已加密 / 已验证 / 解密失败**
- **房间人数限制**：每个房间最多 **2 人**
- **服务端只转发**：不保存、不解密消息

## 运行（Windows + conda）

```powershell
cd D:\密码学作业2025（替换成你的文件路径）

conda create -n crypto-chat python=3.10 -y
conda activate crypto-chat

pip install -r requirements.txt
python server.py
```

浏览器打开：`http://localhost:5000/`

## 使用
1) 两个浏览器窗口输入相同 **房间ID** 和 **房间口令**，点击“加入房间”
2) 比对“派生密钥指纹”一致后开始聊天
3) 第 3 个窗口尝试加入会提示“房间已满（最多 2 人）”

## 文件说明
- `server.py`：Flask-SocketIO 服务端（房间人数限制 + 仅转发）
- `static/index.html`：前端页面
- `static/app.js`：加密/解密、完整性校验、UI 交互、加密状态显示
- `static/style.css`：样式




