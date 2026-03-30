import eventlet
eventlet.monkey_patch()
from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
from models import db, Server, AuditLog, Script, FileTask, Document, AIModel, ScheduledTask
from flask_apscheduler import APScheduler
from utils.ssh_manager import SSHManager
import os
import stat
import paramiko
import random
import threading
import time
from datetime import datetime
from flask_socketio import SocketIO, emit

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# 调度器初始化
scheduler = APScheduler()
scheduler.init_app(app)
scheduler.start()

# 存储 sid 到 SSH 实例的映射
# 结构: { sid: { 'ssh': client, 'shell': shell_chan, 'thread': worker } }
ssh_sessions = {}
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(os.path.dirname(os.path.abspath(__file__)), 'nexus.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
db.init_app(app)

# 全局设置存储 (生产环境应存入数据库)
app_settings = {
    "username": "FuQian",
    "is_pro": True,
    "theme": "dark",
    "language": "zh-CN",
    "ai_provider": "openai",
    "ai_api_key": "",
    "ai_base_url": "https://api.openai.com/v1",
    "ai_model": "gpt-4"
}

with app.app_context():
    db.create_all()
    # 初始化一些 Mock 数据到数据库（如果为空）
    if not Server.query.first():
        s1 = Server(name="Production-Web-01", ip="127.0.0.1", username="admin", status="online", group="生产环境")
        db.session.add(s1)
        db.session.commit()
    
    if not Script.query.first():
        scripts = [
            Script(name="检查磁盘空间", content="df -h", type="shell", description="显示所有分区的磁盘使用情况"),
            Script(name="重启 Nginx", content="systemctl restart nginx", type="shell", description="立即重启负载均衡服务"),
            Script(name="系统负载监控", content="top -bn1 | grep load | awk '{print $11 $12 $13}'", type="shell", description="获取 CPU 平均负载")
        ]
        db.session.bulk_save_objects(scripts)
        db.session.commit()
    
    if not Document.query.first():
        docs = [
            Document(title="服务器选购指南", category="采购", content="# 运维必看\n\n1. 优先选择 4 核 8G 以上配置...\n2. 腾讯云/阿里云/华为云对比见下表。"),
            Document(title="故障排查手册", category="应急", content="## SSH 连接失败\n\n- 检查安全组 22 端口\n- 检查 iptables\n- `ping` 命令确认联通性")
        ]
        db.session.bulk_save_objects(docs)
        db.session.commit()

    if not AIModel.query.first():
        default_model = AIModel(
            name="OpenAI (Default)",
            provider="openai",
            base_url="https://api.openai.com/v1",
            api_key="",
            model_name="gpt-4",
            is_active=True
        )
        db.session.add(default_model)
        db.session.commit()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/status')
def status():
    return jsonify({"status": "running", "version": "1.0.0-alpha"})

@app.route('/api/servers', methods=['GET'])
def get_servers():
    servers = Server.query.all()
    return jsonify([s.to_dict() for s in servers])

@app.route('/api/servers', methods=['POST'])
def add_server():
    data = request.json
    new_server = Server(
        name=data.get('name'),
        ip=data.get('ip'),
        port=data.get('port', 22),
        username=data.get('username'),
        password=data.get('password'),
        group=data.get('group', '默认分组')
    )
    db.session.add(new_server)
    db.session.commit()
    return jsonify({"success": True, "server": new_server.to_dict()})

# --- SFTP 功能接口 ---
def get_sftp_client(server_id, sid=None):
    server = Server.query.get(server_id)
    if not server:
        return None, None
    
    # 为演示环境 (127.0.0.1) 提供 Mock 支持
    if server.ip == "127.0.0.1":
        return "MOCK_CLIENT", None
    
    # 优先复用 Socket 现有的 SSH 链接 (隧道复用)
    if sid and sid in ssh_sessions:
        print(f"Reusing existing SSH session for SID: {sid}")
        try:
            ssh = ssh_sessions[sid].get('ssh')
            if ssh and ssh.get_transport() and ssh.get_transport().is_active():
                return ssh.open_sftp(), None # 复用模式下不需额处关闭 client
        except Exception as e:
            msg = str(e)
            if "subsystem" in msg.lower():
                msg = "SFTP 子系统未在本服务器激活，请检查 sshd_config"
            print(f"Reuse SSH failed: {msg}")
            return None, None # 复用失败则不再强行回退连接，防止多次失败

    # 回退：独立连接
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=server.ip, 
            port=server.port, 
            username=server.username, 
            password=server.password,
            timeout=20,
            allow_agent=False,
            look_for_keys=False
        )
        sftp = client.open_sftp()
        return sftp, client 
    except Exception as e:
        print(f"SFTP Connect Error for {server.ip}: {e}")
        try: client.close()
        except: pass
        return None, None

@app.route('/api/sftp/list', methods=['POST'])
def sftp_list():
    data = request.json
    server_id = data.get('server_id')
    path = data.get('path', '/')
    sid = data.get('sid')
    
    sftp, transport = get_sftp_client(server_id, sid)
    if sftp == "MOCK_CLIENT":
        mock_files = [
            {"name": "etc", "size": 4096, "type": "dir", "mtime": "2026-03-28 12:00:00"},
            {"name": "home", "size": 4096, "type": "dir", "mtime": "2026-03-28 12:05:00"},
            {"name": "config.yaml", "size": 1024, "type": "file", "mtime": "2026-03-28 17:30:00"},
            {"name": "script.py", "size": 256, "type": "file", "mtime": "2026-03-28 17:45:00"},
            {"name": "README.md", "size": 512, "type": "file", "mtime": "2026-03-28 17:50:00"}
        ]
        return jsonify({"success": True, "files": mock_files, "path": path})
    if not sftp: return jsonify({"success": False, "error": "SFTP connection failed"})
    
    try:
        files = []
        for attr in sftp.listdir_attr(path):
            mode = attr.st_mode
            is_dir = stat.S_ISDIR(mode)
            files.append({
                "name": attr.filename,
                "size": attr.st_size,
                "type": "dir" if is_dir else "file",
                "mtime": datetime.fromtimestamp(attr.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
            })
        sftp.close()
        if transport: transport.close()
        return jsonify({"success": True, "files": sorted(files, key=lambda x: (x['type'] != 'dir', x['name'])), "path": path})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/api/sftp/download', methods=['GET'])
def sftp_download():
    server_id = request.args.get('server_id')
    path = request.args.get('path')
    sid = request.args.get('sid')
    
    sftp, transport = get_sftp_client(server_id, sid)
    if sftp == "MOCK_CLIENT":
        # 演示环境下载逻辑：返回一个固定的文本流
        from flask import make_response
        response = make_response("Mock file content for demonstration.")
        response.headers['Content-Disposition'] = f'attachment; filename={os.path.basename(path)}'
        return response
        
    if not sftp: return "SFTP connection failed", 400
    
    try:
        import io as python_io
        file_buffer = python_io.BytesIO()
        sftp.getfo(path, file_buffer)
        sftp.close()
        if transport: transport.close()
        
        file_buffer.seek(0)
        from flask import send_file
        return send_file(file_buffer, as_attachment=True, download_name=os.path.basename(path))
    except Exception as e:
        return str(e), 500

@app.route('/api/sftp/upload', methods=['POST'])
def sftp_upload():
    if 'file' not in request.files: return jsonify({"success": False, "error": "No file part"})
    file = request.files['file']
    server_id = request.form.get('server_id')
    remote_path = request.form.get('path')
    sid = request.form.get('sid')
    
    filename = file.filename
    full_path = os.path.join(remote_path, filename).replace('\\', '/')
    
    sftp, transport = get_sftp_client(server_id, sid)
    if sftp == "MOCK_CLIENT":
        return jsonify({"success": True})
        
    if not sftp: return jsonify({"success": False, "error": "SFTP connection failed"})
    
    try:
        sftp.putfo(file.stream, full_path)
        sftp.close()
        if transport: transport.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/api/sftp/delete', methods=['POST'])
def sftp_delete():
    data = request.json
    server_id = data.get('server_id')
    path = data.get('path')
    sid = data.get('sid')

    sftp, transport = get_sftp_client(server_id, sid)
    if sftp == "MOCK_CLIENT":
        return jsonify({"success": True})
    if not sftp: return jsonify({"success": False, "error": "SFTP connection failed"})

    try:
        # 简单判断是文件还是目录（这里假定是文件）
        sftp.remove(path)
        sftp.close()
        if transport: transport.close()
        return jsonify({"success": True})
    except Exception as e:
        # 如果 remove 失败，尝试 rmdir
        try:
            sftp.rmdir(path)
            sftp.close()
            if transport: transport.close()
            return jsonify({"success": True})
        except:
            return jsonify({"success": False, "error": str(e)})
@app.route('/api/sftp/read', methods=['POST'])
def sftp_read():
    data = request.json
    server_id = data.get('server_id')
    path = data.get('path')
    sid = data.get('sid')
    sftp, transport = get_sftp_client(server_id, sid)
    if sftp == "MOCK_CLIENT":
        content = "# Mock Content\n"
        if "config.yaml" in path: content = "server:\n  port: 8080\n  debug: true\ndatabase:\n  url: sqlite:///nexus.db"
        elif "script.py" in path: content = "import os\n\ndef main():\n    print('Hello from Nexus Mock!')\n\nif __name__ == '__main__':\n    main()"
        elif "README.md" in path: content = "# Nexus SFTP Demo\n\nThis is a mock file for 127.0.0.1 demonstrating the editor."
        return jsonify({"success": True, "content": content})
    if not sftp: return jsonify({"success": False, "error": "SFTP connection failed"})
    try:
        import io as python_io
        file_buffer = python_io.BytesIO()
        sftp.getfo(path, file_buffer)
        content = file_buffer.getvalue().decode('utf-8', errors='replace')
        sftp.close()
        if transport: transport.close()
        return jsonify({"success": True, "content": content})
    except Exception as e: return jsonify({"success": False, "error": str(e)})

@app.route('/api/sftp/write', methods=['POST'])
def sftp_write():
    data = request.json
    server_id = data.get('server_id')
    path = data.get('path')
    content = data.get('content', '')
    sid = data.get('sid')
    sftp, transport = get_sftp_client(server_id, sid)
    if sftp == "MOCK_CLIENT": return jsonify({"success": True})
    if not sftp: return jsonify({"success": False, "error": "SFTP connection failed"})
    try:
        import io as python_io
        file_buffer = python_io.BytesIO(content.encode('utf-8'))
        sftp.putfo(file_buffer, path)
        sftp.close()
        if transport: transport.close()
        return jsonify({"success": True})
    except Exception as e: return jsonify({"success": False, "error": str(e)})

@app.route('/api/execute', methods=['POST'])
def execute_cmd():
    data = request.json
    server_id = data.get('server_id')
    command = data.get('command')
    
    server = Server.query.get(server_id)
    if not server:
        return jsonify({"success": False, "error": "Server not found"})
    
    # 执行 SSH 命令
    result = SSHManager.execute_command(
        server.ip, server.port, server.username, server.password, command
    )
    
    # 记录审计日志
    log = AuditLog(server_id=server.id, command=command, output=result.get('output', '') + result.get('error', ''))
    db.session.add(log)
    db.session.commit()
    
    return jsonify(result)

@app.route('/api/servers/<int:server_id>', methods=['PUT', 'DELETE'])
def update_delete_server(server_id):
    server = Server.query.get(server_id)
    if not server:
        return jsonify({"success": False, "error": "Server not found"})
    
    if request.method == 'DELETE':
        db.session.delete(server)
        db.session.commit()
        return jsonify({"success": True})
    
    # PUT: 编辑
    data = request.json
    server.name = data.get('name', server.name)
    server.ip = data.get('ip', server.ip)
    server.port = data.get('port', server.port)
    server.username = data.get('username', server.username)
    if data.get('password'):
        server.password = data.get('password')
    server.group = data.get('group', server.group)
    db.session.commit()
    return jsonify({"success": True, "server": server.to_dict()})

# --- 脚本管理 API ---
@app.route('/api/scripts', methods=['GET'])
def get_scripts():
    scripts = Script.query.all()
    return jsonify([{
        "id": s.id, "name": s.name, "type": s.type, "content": s.content, "description": s.description
    } for s in scripts])

@app.route('/api/scripts', methods=['POST'])
def add_script():
    data = request.json
    script = Script(
        name=data.get('name'),
        content=data.get('content'),
        type=data.get('type', 'shell'),
        description=data.get('description')
    )
    db.session.add(script)
    db.session.commit()
    return jsonify({"success": True, "id": script.id})

@app.route('/api/scripts/execute', methods=['POST'])
def execute_script():
    data = request.json
    server_ids = data.get('server_ids', [])
    script_id = data.get('script_id')
    
    script = Script.query.get(script_id)
    if not script:
        return jsonify({"success": False, "error": "Script not found"})
    
    results = []
    for sid in server_ids:
        server = Server.query.get(sid)
        if server:
            # 执行脚本内容
            res = SSHManager.execute_command(
                server.ip, server.port, server.username, server.password, script.content
            )
            results.append({"server": server.name, "result": res})
            
            # 记录审计
            log = AuditLog(server_id=server.id, command=f"EXEC SCRIPT: {script.name}", output=str(res))
            db.session.add(log)
    
    db.session.commit()
    return jsonify({"success": True, "results": results})

# --- 文件分发 API ---
@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No file part"})
    file = request.files['file']
    if file.filename == '':
        return jsonify({"success": False, "error": "No selected file"})
    
    filename = file.filename
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    return jsonify({"success": True, "filename": filename, "filepath": filepath})

@app.route('/api/distribute', methods=['POST'])
def distribute_file():
    data = request.json
    filename = data.get('filename')
    remote_path = data.get('remote_path')
    server_ids = data.get('server_ids', [])
    
    local_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(local_path):
        return jsonify({"success": False, "error": "Local file not found"})
    
    results = []
    for sid in server_ids:
        server = Server.query.get(sid)
        if server:
            task = FileTask(filename=filename, local_path=local_path, remote_path=remote_path, server_id=server.id)
            db.session.add(task)
            
            # 使用 SFTP 分发
            try:
                transport = paramiko.Transport((server.ip, server.port))
                transport.connect(username=server.username, password=server.password)
                sftp = paramiko.SFTPClient.from_transport(transport)
                sftp.put(local_path, remote_path)
                sftp.close()
                transport.close()
                task.status = 'success'
                results.append({"server": server.name, "success": True})
            except Exception as e:
                task.status = 'failed'
                results.append({"server": server.name, "success": False, "error": str(e)})
    
    db.session.commit()
    return jsonify({"success": True, "results": results})

@app.route('/api/monitoring/<int:server_id>', methods=['GET'])
def get_monitoring_data(server_id):
    server = Server.query.get(server_id)
    if not server:
        return jsonify({"success": False, "error": "Server not found"})
    
    # 模拟数据：如果 IP 是 127.0.0.1，尝试使用 psutil (如果安装了的话)
    cpu = random.randint(5, 85)
    mem = random.randint(20, 90)
    
    try:
        import psutil
        if server.ip == "127.0.0.1":
            cpu = psutil.cpu_percent()
            mem = psutil.virtual_memory().percent
    except ImportError:
        pass

    data = {
        "cpu_usage": cpu,
        "mem_usage": mem,
        "disk_usage": random.randint(30, 70),
        "load_average": [round(random.uniform(0.1, 2.0), 2) for _ in range(3)],
        "timestamp": datetime.utcnow().strftime('%H:%M:%S')
    }
    return jsonify({"success": True, "data": data})

@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    global app_settings
    if request.method == 'POST':
        data = request.json
        app_settings.update(data)
        return jsonify({"success": True})
    return jsonify(app_settings)

# --- 知识中心 API ---
@app.route('/api/docs', methods=['GET'])
def get_docs():
    docs = Document.query.all()
    return jsonify([{
        "id": d.id, "title": d.title, "category": d.category, "content": d.content, "last_modified": d.last_modified.strftime('%Y-%m-%d %H:%M')
    } for d in docs])

@app.route('/api/docs/<int:doc_id>', methods=['GET'])
def get_doc_detail(doc_id):
    doc = Document.query.get(doc_id)
    if not doc:
        return jsonify({"success": False, "error": "Document not found"})
    return jsonify({"success": True, "doc": {
        "id": doc.id, "title": doc.title, "content": doc.content
    }})

# --- AI 助手 API ---
@app.route('/api/models', methods=['GET', 'POST'])
def handle_models():
    if request.method == 'POST':
        data = request.json
        # 如果是设为激活
        if data.get('action') == 'activate':
            AIModel.query.update({AIModel.is_active: False})
            m = AIModel.query.get(data.get('id'))
            if m:
                m.is_active = True
                db.session.commit()
                return jsonify({"success": True})
        
        # 新增模型
        new_m = AIModel(
            name=data.get('name'),
            provider=data.get('provider'),
            base_url=data.get('base_url'),
            api_key=data.get('api_key'),
            model_name=data.get('model_name'),
            is_active=data.get('is_active', False)
        )
        if new_m.is_active:
             AIModel.query.update({AIModel.is_active: False})
        db.session.add(new_m)
        db.session.commit()
        return jsonify({"success": True, "model": new_m.to_dict()})
        
    models = AIModel.query.all()
    return jsonify([m.to_dict() for m in models])

@app.route('/api/models/<int:mid>', methods=['PUT', 'DELETE'])
def update_delete_model(mid):
    m = AIModel.query.get(mid)
    if not m: return jsonify({"success": False, "error": "Model not found"})
    
    if request.method == 'DELETE':
        # 不允许删除最后一个激活的模型
        if m.is_active:
            other = AIModel.query.filter(AIModel.id != mid).first()
            if other: other.is_active = True
        db.session.delete(m)
        db.session.commit()
        return jsonify({"success": True})
        
    data = request.json
    m.name = data.get('name', m.name)
    m.provider = data.get('provider', m.provider)
    m.base_url = data.get('base_url', m.base_url)
    m.api_key = data.get('api_key', m.api_key)
    m.model_name = data.get('model_name', m.model_name)
    if data.get('is_active'):
        AIModel.query.update({AIModel.is_active: False})
        m.is_active = True
    db.session.commit()
    return jsonify({"success": True, "model": m.to_dict()})

@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    data = request.json
    import requests
    message = data.get('message', '')
    model_id = data.get('model_id') # 前端可以选择模型，如果不传则选激活的
    
    if model_id:
        config = AIModel.query.get(model_id)
    else:
        config = AIModel.query.filter_by(is_active=True).first()

    if not config:
        return jsonify({"success": False, "error": "未配置 AI 模型。请在设置中添加。"})

    provider = config.provider
    api_key = config.api_key
    base_url = (config.base_url or "").rstrip('/')
    model = config.model_name or "gpt-4"

    if provider == 'local' or not api_key:
        server_count = Server.query.count()
        response = f"我是 Nexus 助手。当前模型 '{config.name}' 未检测到有效 API Key，我将由本地内置逻辑协助您。当前系统中有 {server_count} 个服务节点。"
        return jsonify({"success": True, "reply": response})

    try:
        headers = { "Authorization": f"Bearer {api_key}", "Content-Type": "application/json" }
        system_prompt = "You are Nexus DevOps Expert, an AI assistant integrated into a professional O&M platform. Be concise, technical, and helpful. Focus on Linux/SSH/SFTP and monitoring tasks."
        
        payload = {
            "model": model,
            "messages": [ {"role": "system", "content": system_prompt}, {"role": "user", "content": message} ],
            "temperature": 0.7
        }

        # 统一使用 OpenAI 协议请求
        target_url = f"{base_url}/chat/completions"
        
        print(f"[AI] Sending request to {target_url} using model {model} (Provider: {provider})")
        # 增加超时时间至 120s 以应对慢速模型响应
        resp = requests.post(target_url, headers=headers, json=payload, timeout=120)
        
        if resp.status_code == 200:
            resp_data = resp.json()
            reply = resp_data['choices'][0]['message']['content']
            return jsonify({"success": True, "reply": reply})
        else:
            try:
                err_data = resp.json()
                error_msg = err_data.get('error', {}).get('message', 'API Error')
            except:
                error_msg = f"HTTP {resp.status_code}: {resp.text[:100]}"
            return jsonify({"success": False, "error": f"API Error: {error_msg}"})
    except Exception as e:
        # 提供更具体的错误诊断
        err_str = str(e)
        if "timed out" in err_str:
            err_str = f"请求超时 (120s)。模型未在规定时间内返回结果，请检查网络或更换模型。({target_url})"
        return jsonify({"success": False, "error": f"Connection Exception: {err_str}"})

# --- 自动化任务 (Automation) 接口 ---

@app.route('/api/automation/execute', methods=['POST'])
def auto_execute():
    data = request.json
    server_ids = data.get('server_ids', [])
    command = data.get('command', '')
    
    results = {}
    
    def run_on_server(srv_id, cmd):
        server = Server.query.get(srv_id)
        if not server: return {"success": False, "output": "Server not found"}
        if server.ip == "127.0.0.1": 
            return {"success": True, "output": f"[MOCK] Executed '{cmd}' on local node.\nResult: OK"}
            
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(server.ip, port=server.port, username=server.username, password=server.password, timeout=20)
            stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            client.close()
            return {"success": True, "output": out + err}
        except Exception as e:
            return {"success": False, "output": f"Connection/Exec Error: {str(e)}"}

    # 并发执行 (使用 eventlet 协程以适配 WebSocket 并发)
    import eventlet
    pool = eventlet.GreenPool(size=10)
    
    def worker(srv_id):
        # 核心修复：在新协程中提供 Flask 应用上下文，否则 SQLAlchemy 查询会报错
        with app.app_context():
            try:
                results[str(srv_id)] = run_on_server(srv_id, command)
            except Exception as e:
                results[str(srv_id)] = {"success": False, "output": f"Worker Context Error: {str(e)}"}
        
    for sid in server_ids:
        pool.spawn_n(worker, sid)
    
    pool.waitall()
    # 强制确保 results 不为空
    if not results:
        results = {"status": {"success": False, "output": "未收集到执行结果，请检查后端并发状态。"}}
    return jsonify({"success": True, "results": results})

@app.route('/api/scripts', methods=['GET', 'POST'])
def handle_scripts():
    if request.method == 'GET':
        scripts = Script.query.all()
        return jsonify([{"id": s.id, "name": s.name, "content": s.content, "type": s.type, "description": s.description} for s in scripts])
    
    data = request.json
    script = Script(
        name=data.get('name'),
        content=data.get('content'),
        type=data.get('type', 'shell'),
        description=data.get('description')
    )
    db.session.add(script)
    db.session.commit()
    return jsonify({"success": True, "script_id": script.id})

@app.route('/api/scripts/<int:sid>', methods=['PUT', 'DELETE'])
def update_delete_script(sid):
    script = Script.query.get(sid)
    if not script: return jsonify({"success": False, "error": "Script not found"})
    
    if request.method == 'DELETE':
        db.session.delete(script)
        db.session.commit()
        return jsonify({"success": True})
    
    data = request.json
    script.name = data.get('name', script.name)
    script.content = data.get('content', script.content)
    script.type = data.get('type', script.type)
    script.description = data.get('description', script.description)
    db.session.commit()
    return jsonify({"success": True})

@app.route('/api/automation/distribute', methods=['POST'])
def auto_distribute():
    # 核心实现：多机并发文件分发 (增强异常补获防止 HTML 报错)
    try:
        if 'file' not in request.files:
            return jsonify({"success": False, "error": "No file uploaded"})
        
        file = request.files['file']
        server_ids = request.form.getlist('server_ids[]')
        remote_path = request.form.get('remote_path', '/tmp/')
        
        if not server_ids:
            return jsonify({"success": False, "error": "No target servers selected"})

        # 确保临时文件夹存在 (防止 FileNotFoundError)
        temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'temp')
        os.makedirs(temp_dir, exist_ok=True)
        temp_path = os.path.join(temp_dir, file.filename)
        file.save(temp_path)
        
        results = {}
        pool = eventlet.GreenPool(size=10)

        def distribute_worker(srv_id):
            with app.app_context():
                try:
                    server = Server.query.get(srv_id)
                    if not server:
                        results[str(srv_id)] = {"success": False, "error": "Server index not found"}
                        return

                    client = paramiko.SSHClient()
                    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                    try:
                        client.connect(server.ip, port=server.port, username=server.username, password=server.password, timeout=20)
                        sftp = client.open_sftp()
                        
                        # 检测远程目录并尝试创建 (单层)
                        try:
                            sftp.chdir(remote_path)
                        except IOError:
                            try:
                                sftp.mkdir(remote_path)
                            except: pass
                            
                        target_file = os.path.join(remote_path, file.filename).replace('\\', '/')
                        sftp.put(temp_path, target_file)
                        sftp.close()
                        client.close()
                        results[str(srv_id)] = {"success": True, "message": f"Successfully pushed to {target_file}"}
                    except Exception as e:
                        results[str(srv_id)] = {"success": False, "error": f"SFTP Error: {str(e)}"}
                except Exception as ex:
                    results[str(srv_id)] = {"success": False, "error": f"Worker Error: {str(ex)}"}

        for sid in server_ids:
            try:
                pool.spawn_n(distribute_worker, int(sid))
            except: pass
        
        pool.waitall()
        
        # 任务完成后清理该特定临时文件
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except: pass
            
        return jsonify({"success": True, "results": results})
    except Exception as global_err:
        # 最后一道防线：返回 JSON 而非 HTML 报错
        return jsonify({"success": False, "error": f"System Global Error: {str(global_err)}"})

@app.route('/api/automation/tasks', methods=['GET', 'POST'])
def handle_scheduled_tasks():
    if request.method == 'GET':
        tasks = ScheduledTask.query.all()
        return jsonify([t.to_dict() for t in tasks])
    
    data = request.json
    task = ScheduledTask(
        name=data.get('name'),
        cron=data.get('cron'),
        command=data.get('command'),
        target_servers=data.get('target_servers'), # 逗号分隔的 ID
        status='active'
    )
    db.session.add(task)
    db.session.commit()
    
    # 将任务添加到 APScheduler
    try:
        def job_function(cmd, srv_ids):
            with app.app_context():
                print(f"[Scheduler] Running: {cmd} on {srv_ids}")
        
        cron_parts = data.get('cron').split()
        scheduler.add_job(
            id=str(task.id),
            func=job_function,
            trigger='cron',
            args=[task.command, task.target_servers],
            minute=cron_parts[0],
            hour=cron_parts[1],
            day=cron_parts[2],
            month=cron_parts[3],
            day_of_week=cron_parts[4]
        )
    except Exception as e:
        print(f"Scheduler error: {str(e)}")

    return jsonify({"success": True, "task": task.to_dict()})

@app.route('/api/automation/tasks/<int:tid>', methods=['DELETE'])
def delete_scheduled_task(tid):
    task = ScheduledTask.query.get(tid)
    if task:
        try: scheduler.remove_job(str(tid))
        except: pass
        db.session.delete(task)
        db.session.commit()
    return jsonify({"success": True})

@app.route('/api/automation/tasks/<int:tid>/toggle', methods=['POST'])
def toggle_task(tid):
    task = ScheduledTask.query.get(tid)
    if not task:
        return jsonify({"success": False, "error": "Task not found"})
    
    try:
        if task.status == 'active':
            scheduler.pause_job(str(tid))
            task.status = 'paused'
        else:
            scheduler.resume_job(str(tid))
            task.status = 'active'
        db.session.commit()
        return jsonify({"success": True, "status": task.status})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/api/automation/inspect', methods=['POST'])
def auto_inspect():
    # 核心巡检逻辑：并发批量执行监控指令
    servers = Server.query.all()
    results = []
    pool = eventlet.GreenPool(size=10)

    def inspector(srv):
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(srv.ip, port=srv.port, username=srv.username, password=srv.password, timeout=20)
            # 组合巡检命令：Load, Memory, Disk
            stdin, stdout, stderr = client.exec_command("uptime; free -m | grep Mem; df -h / | tail -1")
            output = stdout.read().decode().strip().split('\n')
            client.close()
            
            # 解析 (简单逻辑)
            load = output[0].split('load average:')[-1].strip() if len(output)>0 else 'N/A'
            mem_info = output[1].split() if len(output)>1 else []
            mem_usage = f"{mem_info[2]}/{mem_info[1]}MB" if len(mem_info)>2 else 'N/A'
            disk_info = output[2].split() if len(output)>2 else []
            disk_usage = disk_info[4] if len(disk_info)>4 else 'N/A'
            
            status = 'pass'
            if disk_usage != 'N/A' and int(disk_usage.replace('%','')) > 85: status = 'warning'
            
            return {
                "item": f"{srv.name} 健康状态",
                "status": status,
                "desc": f"负载: {load} | 内存: {mem_usage} | 磁盘: {disk_usage}"
            }
        except Exception as e:
            return {
                "item": f"{srv.name} 连接异常",
                "status": "fail",
                "desc": f"SSH 失败: {str(e)}"
            }

    for r in pool.imap(inspector, servers):
        results.append(r)

    return jsonify({"success": True, "data": results})

# --- WebSocket 终端逻辑 (Xshell 风格) ---
@socketio.on('ssh_connect')
def handle_ssh_connect(data):
    sid = request.sid
    server_id = data.get('server_id')
    server = Server.query.get(server_id)
    if not server:
        emit('terminal_output', '\r\n[ERROR] Server not found in database.\r\n')
        return

    try:
        import paramiko
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(server.ip, port=server.port, username=server.username, password=server.password, timeout=20)
        
        # 激活 PTY Shell
        shell = ssh.invoke_shell(term='xterm', width=80, height=24)
        ssh_sessions[sid] = {'ssh': ssh, 'shell': shell}
        
        emit('terminal_output', f'\r\n[NEXUS] 正在为 {server.name} ({server.ip}) 建立加密隧道...\r\n')
        
        # 启动后台读取线程 (使用 SocketIO 的协程方式)
        def read_from_shell(sid, shell):
            while sid in ssh_sessions:
                if shell.recv_ready():
                    data = shell.recv(4096).decode('utf-8', errors='ignore')
                    socketio.emit('terminal_output', data, room=sid)
                else:
                    socketio.sleep(0.02) # 防止 CPU 占用过高
            
        socketio.start_background_task(read_from_shell, sid, shell)
        
    except Exception as e:
        emit('terminal_output', f'\r\n[ERROR] Connection failed: {str(e)}\r\n')

@socketio.on('terminal_input')
def handle_terminal_input(data):
    sid = request.sid
    if sid in ssh_sessions:
        shell = ssh_sessions[sid]['shell']
        shell.send(data)

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    if sid in ssh_sessions:
        try:
            ssh_sessions[sid]['ssh'].close()
        except: pass
        del ssh_sessions[sid]
        print(f"Session {sid} closed.")

if __name__ == '__main__':
    # 必须使用 socketio.run 代替 app.run 以支持 WebSocket
    socketio.run(app, debug=True, port=5000, host='0.0.0.0')
