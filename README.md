# Nexus AIOps - 智能 AI 驱动的一站式运维管理平台

![Nexus Welcome Screen](file:///C:/Users/35866/.gemini/antigravity/brain/acd8bb45-a6fa-42c2-9f61-2dbb03004b79/nexus_welcome_screen_optimized_1774863178348.png)

Nexus 是一款专为现代化运维团队打造的**类 IDE 沉浸式**智能运维平台。它融合了传统的服务器管理、自动化执行、系统监控，以及最前沿的 AI 辅助能力，旨在通过极致的 UI 交互与 AI 智能，将运维人员从低效的重复劳动中彻底解放。

## ✨ 核心特性

### 1. 极致美学与交互 (Premium UI/UX)
- **Trae/VS Code 风格**: 沉浸式的侧边栏与多标签页管理。
- **极致设计系统**: 全面采用 **Glassmorphism (毛玻璃)**、**HSL 调和色彩** 与 **3D 物理按键样式**。
- **动态欢迎页**: 集成打字机动画光标与脉冲式科技 Logo。

### 2. 高级自动化任务 (Advanced Automation)
- **节点卡片管理**: 告别单调列表，使用交互式服务器卡片进行资产管理。
- **脚本库 2.0**: 网格化布局的脚本中心，支持即时预览与一键下发。
- **可视化巡检**: 自动化生成包含 **SVG 环形图表** 的高颜值巡检报告。

### 3. 多模态 AI 助手 (AI Copilot)
- **智能对话**: 侧边栏常驻 AI，支持日志分析、脚本生成与知识问答。
- **灵活适配**: 原生支持 OpenAI API、Ollama (本地) 等多种模型引擎。

### 4. 专业终端体验 (Pro Terminal)
- **WebSocket 实时通信**: 极低延迟的远程 Shell 交互。
- **可视化 SFTP**: 拖拽式文件传输，支持在线编辑远程文件。

## 📸 界面预览

| 欢迎界面 | 系统巡检 |
| :--- | :--- |
| ![Welcome](file:///C:/Users/35866/.gemini/antigravity/brain/acd8bb45-a6fa-42c2-9f61-2dbb03004b79/nexus_welcome_screen_optimized_1774863178348.png) | ![Inspection](file:///C:/Users/35866/.gemini/antigravity/brain/acd8bb45-a6fa-42c2-9f61-2dbb03004b79/inspection_results_1774862876247.png) |

## 🚀 快速开始

### 1. 环境准备
确保您的系统中已安装 Python 3.8+。建议使用虚拟环境：
```bash
python -m venv venv
source venv/Scripts/activate  # Windows
```

### 2. 安装依赖
```bash
pip install -r requirements.txt
```

### 3. 启动应用
```bash
python app.py
```
默认访问地址：`http://localhost:5000`

## 🛠️ 技术栈
- **Backend**: Python Flask, Flask-SocketIO, SQLAlchemy, Paramiko (SSH)
- **Frontend**: Vanilla JS, CSS3, HTML5, Lucide Icons, Xterm.js
- **Database**: SQLite (Default)

## 📄 License
This project is licensed under the MIT License.

---
*Nexus - 为运维注入智能动力*
