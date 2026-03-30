document.addEventListener('DOMContentLoaded', () => {
    // --- 全局状态管理 ---
    const sessions = {}; // { serverId: { server, term, fit, socket, currentPath, el } }
    let activeSessionId = null;
    let aceEditor = null;
    let aiModels = [];

    // --- 核心调试：初始化编辑器 ---
    function initAce() {
        if (!aceEditor && window.ace) {
            // 修正 CDN 路径以确保加载 Mode / Theme 文件 (强力版)
            const aceConfig = ace.require("ace/config");
            aceConfig.set("basePath", "https://cdnjs.cloudflare.com/ajax/libs/ace/1.31.2/");
            aceConfig.set("modePath", "https://cdnjs.cloudflare.com/ajax/libs/ace/1.31.2/");
            aceConfig.set("themePath", "https://cdnjs.cloudflare.com/ajax/libs/ace/1.31.2/");
            
            aceEditor = ace.edit("ace-editor-container");
            aceEditor.setTheme("ace/theme/monokai"); // 使用色彩更丰富的 Monokai 主题
            aceEditor.setShowPrintMargin(false);
            aceEditor.setOptions({ 
                fontSize: "14px", 
                lineHeight: "22px",
                useSoftTabs: true,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                showGutter: true,
                highlightActiveLine: true,
                wrap: true,
                dragEnabled: true,
                enableBasicAutocompletion: true,
                enableLiveAutocompletion: true
            });
            // 增加内容填充，防止代码贴边
            aceEditor.renderer.setPadding(20);
            aceEditor.renderer.setScrollMargin(10, 10);
        }
    }

    // --- 图标渲染 ---
    function safeCreateIcons() {
        try { if (window.lucide) window.lucide.createIcons(); } catch (e) {}
    }

    // --- 核心事件代理 ---
    document.addEventListener('click', async (e) => {
        // --- 核心动作代理 (高优先级) ---
        
        // 1. 自动化任务脚本逻辑
        const scriptRunBtn = e.target.closest('.script-run');
        if (scriptRunBtn) {
            console.log("Script Run Clicked");
            const content = decodeURIComponent(scriptRunBtn.dataset.content);
            renderAutomationSub('execute');
            setTimeout(() => {
                const editor = document.getElementById('auto-cmd-input');
                if (editor) editor.value = content;
            }, 100);
            return;
        }

        const scriptDelBtn = e.target.closest('.script-del-wrap');
        if (scriptDelBtn) {
            const sid = scriptDelBtn.dataset.id;
            console.log("Delete Button Clicked, ID:", sid);
            if(confirm("确定彻底删除此脚本及其历史记录？")) {
                const res = await fetch(`/api/scripts/${sid}`, { method: 'DELETE' });
                const data = await res.json();
                console.log("Delete Response:", data);
                const stage = document.getElementById('module-container');
                if (stage) renderScriptManagement(stage);
            }
            return;
        }

        const scriptEditBtn = e.target.closest('.script-edit-wrap');
        if (scriptEditBtn) {
            const sid = scriptEditBtn.dataset.id;
            console.log("Edit Button Clicked, ID:", sid);
            const res = await fetch('/api/scripts');
            const list = await res.json();
            const s = list.find(x => String(x.id) === String(sid));
            const stage = document.getElementById('module-container');
            if (s && stage) showScriptModal(s, stage);
            return;
        }

        const addScriptBtn = e.target.closest('#add-script-btn');
        if (addScriptBtn) {
            console.log("Add Script Button Clicked");
            const stage = document.getElementById('module-container');
            if (stage) showScriptModal(null, stage);
            return;
        }

        // 2. 基础导航切换
        const navItem = e.target.closest('.nav-item');
        if (navItem) {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            navItem.classList.add('active');
            switchModule(navItem.getAttribute('data-module'));
            return;
        }

        // 3. 资产树操作
        if (e.target.closest('#add-server-btn')) return showServerModal();
        
        const serverItem = e.target.closest('.server-item');
        if (serverItem && !e.target.closest('.action-icon')) {
            const server = JSON.parse(serverItem.getAttribute('data-server'));
            return openSession(server);
        }

        const editBtn = e.target.closest('.action-icon.edit');
        if (editBtn) return showServerModal(JSON.parse(editBtn.closest('.server-item').getAttribute('data-server')));

        const delBtn = e.target.closest('.action-icon.delete');
        if (delBtn) return handleDeleteServer(JSON.parse(delBtn.closest('.server-item').getAttribute('data-server')));

        // 4. SFTP 头部操作
        if (e.target.closest('.btn-upload')) return triggerUpload();
        if (e.target.closest('.refresh-sftp')) {
            if (activeSessionId) loadSFTP(activeSessionId, sessions[activeSessionId].currentPath);
            return;
        }

        // 5. 标签页操作
        const tabEl = e.target.closest('.tabx');
        if (tabEl) {
            const sid = tabEl.getAttribute('data-id');
            if (e.target.closest('.tabx-close')) {
                closeSession(sid);
            } else {
                switchSession(sid);
            }
            return;
        }

        // 6. SFTP 列表项点击 & 操作
        const sftpTr = e.target.closest('.sftp-table tr[data-name]');
        const isAction = e.target.closest('.row-action-btn');
        
        if (sftpTr && activeSessionId) {
            const name = sftpTr.getAttribute('data-name');
            const type = sftpTr.getAttribute('data-type');
            
            if (isAction) {
                if (isAction.classList.contains('download')) {
                    handleDownload(name);
                }
                if (isAction.classList.contains('delete')) {
                    handleDeleteFile(name);
                }
                return;
            }
            handleSFTPClick(name, type);
            return;
        }

        // 7. 其它模态框通用操作
        if (e.target.closest('#close-editor')) {
            document.getElementById('editor-modal').classList.remove('open');
            return;
        }
        if (e.target.id === 'save-file-btn') handleSaveFile();
        if (e.target.closest('#close-modal')) document.getElementById('server-modal').classList.remove('open');
        if (e.target.id === 'save-server') handleSaveServer();

        // 8. 模型配置弹窗
        const closeModelBtn = e.target.closest('#close-model-modal') || e.target.closest('#cancel-model-btn');
        if (closeModelBtn) return closeModelModal();
        if (e.target.id === 'save-modal-model-btn') handleSaveAIModel();
        
        // 9. AI 面板快捷操作
        if (e.target.closest('#ai-add-model-quick')) {
            showAIModelModal();
        }

        // 10. 侧边栏折叠 (资产树)
        const groupHeader = e.target.closest('.folder .group-header');
        if (groupHeader) {
            const folder = groupHeader.closest('.folder');
            folder.classList.toggle('open');
            // 图标旋转已通过 CSS 实现，不再需要 JS 频繁替换图标
            return;
        }
    });

    // --- SFTP 核心逻辑 ---
    async function loadSFTP(sid, path) {
        const session = sessions[sid];
        if (!session) return;
        session.currentPath = path;
        
        const contentArea = session.el.querySelector('.sftp-content');
        contentArea.innerHTML = `<div style="padding:20px; color:#abb2bf; font-style:italic">
            <i data-lucide="loader-2" class="spin" style="width:14px; margin-right:8px"></i> 正在请求列表...
        </div>`;
        safeCreateIcons();

        try {
            const res = await fetch('/api/sftp/list', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ server_id: sid, path, sid: session.socket.id || '' })
            });
            const data = await res.json();
            if (data.success) {
                renderSFTP(sid, data.files, data.path);
            } else {
                contentArea.innerHTML = `<div style="padding:20px; color:#e06c75">SFTP 失败: ${data.error}</div>`;
            }
        } catch (e) {
            contentArea.innerHTML = `<div style="padding:20px; color:#e06c75">异常: ${e.message}</div>`;
        }
    }

    function renderSFTP(sid, files, path) {
        const session = sessions[sid];
        const contentArea = session.el.querySelector('.sftp-content');
        session.el.querySelector('.sftp-path').innerText = path;

        let html = `<table class="sftp-table">
            <thead><tr><th>名称</th><th>大小</th><th>修改时间</th><th style="width:80px">操作</th></tr></thead>
            <tbody>`;
        
        if (path !== '/') {
            html += `<tr data-name=".." data-type="dir">
                <td style="cursor:pointer; color:var(--accent-blue); display:flex; align-items:center"><i data-lucide="folder-up" style="width:14px; margin-right:8px"></i> ..</td>
                <td>-</td><td>-</td><td></td>
            </tr>`;
        }

        files.forEach(f => {
            const isDir = f.type === 'dir';
            const icon = isDir ? 'folder' : 'file-text';
            const sizeDisp = isDir ? '-' : (f.size > 1024*1024 ? (f.size/1024/1024).toFixed(1)+' MB' : (f.size/1024).toFixed(1)+' KB');
            html += `
                <tr data-name="${f.name}" data-type="${f.type}">
                    <td style="cursor:pointer; display:flex; align-items:center"><i data-lucide="${icon}" style="width:14px; margin-right:8px; color:${isDir?'#e5c07b':'#abb2bf'}"></i>${f.name}</td>
                    <td>${sizeDisp}</td>
                    <td>${f.mtime}</td>
                    <td>
                        <div style="display:flex; gap:12px">
                            ${!isDir ? `<i data-lucide="download" class="row-action-btn download" title="下载" style="cursor:pointer; width:14px"></i>` : ''}
                            <i data-lucide="trash-2" class="row-action-btn delete" title="删除" style="cursor:pointer; width:14px"></i>
                        </div>
                    </td>
                </tr>`;
        });
        html += `</tbody></table>`;
        contentArea.innerHTML = html;
        safeCreateIcons();
    }

    async function handleSFTPClick(name, type) {
        if (!activeSessionId || !sessions[activeSessionId]) return;
        const session = sessions[activeSessionId];
        
        if (type === 'dir') {
            let newPath = (name === '..') ? 
                '/' + session.currentPath.split('/').filter(p=>p).slice(0,-1).join('/') : 
                (session.currentPath === '/' ? `/${name}` : `${session.currentPath}/${name}`);
            loadSFTP(activeSessionId, newPath);
        } else {
            openFileEditor(name);
        }
    }

    async function openFileEditor(filename) {
        const session = sessions[activeSessionId];
        const fullPath = (session.currentPath === '/' ? '' : session.currentPath) + '/' + filename;
        
        try {
            const res = await fetch('/api/sftp/read', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ server_id: activeSessionId, path: fullPath, sid: session.socket.id || '' })
            });
            const data = await res.json();
            if (data.success) {
                initAce();
                document.getElementById('editor-filename').innerText = `编辑: ${filename}`;
                const modal = document.getElementById('editor-modal');
                modal.setAttribute('data-path', fullPath);
                modal.setAttribute('data-sid', activeSessionId);
                
                // 设置编辑器内容并匹配高亮模式
                aceEditor.setValue(data.content, -1);
                const ext = filename.split('.').pop().toLowerCase();
                const modes = {
                    'js': 'javascript', 'py': 'python', 'sh': 'sh', 'html': 'html', 'css': 'css',
                    'json': 'json', 'yaml': 'yaml', 'yml': 'yaml', 'md': 'markdown', 'sql': 'sql',
                    'conf': 'sh', 'ini': 'ini', 'log': 'text', 'env': 'sh', 'dockerfile': 'dockerfile',
                    'xml': 'xml', 'php': 'php', 'go': 'golang', 'rb': 'ruby', 'java': 'java'
                };
                aceEditor.session.setMode("ace/mode/" + (modes[ext] || "text"));
                
                modal.classList.add('open');
                setTimeout(() => aceEditor.resize(), 100); // 确保容器尺寸正确后重绘
            } else {
                alert('读取失败: ' + data.error);
            }
        } catch(e) { alert('读取异常: ' + e.message); }
    }

    async function handleSaveFile() {
        const modal = document.getElementById('editor-modal');
        const path = modal.getAttribute('data-path');
        const sid = modal.getAttribute('data-sid');
        const content = aceEditor.getValue();
        
        try {
            const res = await fetch('/api/sftp/write', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ server_id: sid, path, content, sid: sessions[sid].socket.id || '' })
            });
            const data = await res.json();
            if (data.success) {
                alert('保存成功');
                modal.classList.remove('open');
            } else { alert('保存失败: ' + data.error); }
        } catch(e) { alert('保存异常: ' + e.message); }
    }

    function handleDownload(filename) {
        const sid = activeSessionId;
        const path = (sessions[sid].currentPath === '/' ? '' : sessions[sid].currentPath) + '/' + filename;
        const url = `/api/sftp/download?server_id=${sid}&path=${encodeURIComponent(path)}&sid=${sessions[sid].socket.id || ''}`;
        
        // 使用隐藏 <a> 标签下载，避免 window.open 导致的窗口闪烁
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function handleDeleteFile(filename) {
        if (!confirm(`确定删除 ${filename}？`)) return;
        const sid = activeSessionId;
        const path = (sessions[sid].currentPath === '/' ? '' : sessions[sid].currentPath) + '/' + filename;
        
        const res = await fetch('/api/sftp/delete', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ server_id: sid, path, sid: sessions[sid].socket.id || '' })
        });
        if ((await res.json()).success) loadSFTP(sid, sessions[sid].currentPath);
    }

    function triggerUpload() {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const formData = new FormData();
            formData.append('file', file);
            formData.append('server_id', activeSessionId);
            formData.append('path', sessions[activeSessionId].currentPath);
            formData.append('sid', sessions[activeSessionId].socket.id || '');

            const res = await fetch('/api/sftp/upload', { method: 'POST', body: formData });
            if ((await res.json()).success) loadSFTP(activeSessionId, sessions[activeSessionId].currentPath);
        };
        input.click();
    }

    // --- 会话 & 窗口管理 ---
    function openSession(server) {
        const sid = server.id.toString();
        if (sessions[sid]) return switchSession(sid);

        const tabBar = document.getElementById('tab-bar');
        tabBar.insertAdjacentHTML('beforeend', `<div class="tabx" data-id="${sid}">
            <i data-lucide="terminal" style="width:14px; margin-right:6px"></i>
            <span>${server.name}</span>
            <i data-lucide="x" class="tabx-close"></i>
        </div>`);

        const mainStage = document.getElementById('main-content');
        const pageHtml = `
            <div class="tab-page" id="page-${sid}">
                <div class="terminal-row"><div class="terminal-container"><div id="term-${sid}" style="height:100%"></div></div></div>
                <div class="resizer"></div>
                <div class="sftp-row">
                    <div class="sftp-header">
                        <div style="display:flex; align-items:center; gap:10px; overflow:hidden">
                            <i data-lucide="folder" style="width:14px; color:#d19a66"></i>
                            <span class="sftp-path" style="font-size:12px">/</span>
                        </div>
                        <div class="sftp-actions">
                            <i data-lucide="upload-cloud" class="sftp-btn btn-upload" title="上传文件"></i>
                            <i data-lucide="refresh-cw" class="sftp-btn refresh-sftp" title="刷新列表"></i>
                        </div>
                    </div>
                    <div class="sftp-content"><div style="padding:20px; color:#5c6370; font-style:italic">正在连接...</div></div>
                </div>
            </div>`;
        mainStage.insertAdjacentHTML('beforeend', pageHtml);

        const isLight = document.body.classList.contains('theme-light');
        const term = new Terminal({
            cursorBlink: true, fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
            theme: isLight ? { 
                background: '#ffffff', 
                foreground: '#334155', 
                cursor: '#2563eb',
                selection: 'rgba(37, 99, 235, 0.2)',
                black: '#1e293b', red: '#e11d48', green: '#16a34a', yellow: '#ca8a04', 
                blue: '#2563eb', magenta: '#9333ea', cyan: '#0891b2', white: '#cbd5e1'
            } : { 
                background: '#121417', 
                foreground: '#abb2bf', 
                cursor: '#4d8df6' 
            }
        });
        
        const fit = (window.FitAddon && window.FitAddon.FitAddon) ? new window.FitAddon.FitAddon() : null;
        if (fit) term.loadAddon(fit);
        term.open(document.getElementById(`term-${sid}`));
        if (fit) fit.fit();

        const socket = io();
        socket.on('connect', () => { loadSFTP(sid, '/'); });
        socket.on('terminal_output', data => term.write(data));
        term.onData(data => socket.emit('terminal_input', data));
        socket.emit('ssh_connect', { server_id: sid });

        sessions[sid] = { server, term, fit, socket, currentPath: '/', el: document.getElementById(`page-${sid}`) };
        
        // 渲染欢迎信息
        const welcomeText = `
\x1b[1;34m[NEXUS AIOPS SYSTEM v1.0.0]\x1b[0m
\x1b[1;32m● 已成功建立安全隧道至: ${server.name} (${server.ip})\x1b[0m
\x1b[0;90m------------------------------------------------------------\x1b[0m
连接时间: ${new Date().toLocaleString()}
终端协议: SSH-2.0-Paramiko
\x1b[0;90m------------------------------------------------------------\x1b[0m
`;
        term.write(welcomeText.replace(/\n/g, '\r\n'));

        initResizer(sessions[sid].el);
        switchSession(sid);
        safeCreateIcons();
    }

    // --- 自动化增强组件：节点选择器 ---
    function renderNodeSelection(servers, containerId, multi = true) {
        const wrapper = document.getElementById(containerId);
        if (!wrapper) return;
        
        wrapper.className = 'node-selection-wrapper';
        wrapper.innerHTML = servers.map(s => `
            <div class="node-card" data-id="${s.id}">
                <div class="node-info">
                    <i data-lucide="monitor"></i>
                    <span class="node-name">${s.name}</span>
                </div>
                <div class="node-ip">${s.ip}</div>
                <input type="checkbox" class="node-hidden-cb" value="${s.id}" style="display:none">
            </div>
        `).join('');

        wrapper.querySelectorAll('.node-card').forEach(card => {
            card.onclick = () => {
                const cb = card.querySelector('.node-hidden-cb');
                if (!multi) {
                    wrapper.querySelectorAll('.node-card').forEach(c => {
                        c.classList.remove('selected');
                        c.querySelector('.node-hidden-cb').checked = false;
                    });
                }
                card.classList.toggle('selected');
                cb.checked = !cb.checked;
            };
        });
        safeCreateIcons();
    }

    function switchSession(sid) {
        activeSessionId = sid;
        document.getElementById('welcome-screen').style.display = 'none';
        document.querySelectorAll('.tabx').forEach(t => t.classList.toggle('active', t.dataset.id == sid));
        document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id == `page-${sid}`));
        
        const s = sessions[sid];
        if (s) {
            document.getElementById('status-server-name').innerText = `已连接: ${s.server.name}`;
            setTimeout(() => { if (s.fit) s.fit.fit(); s.term.focus(); }, 50);
        }
    }

    function closeSession(sid) {
        const s = sessions[sid];
        if (!s) return;
        s.socket.disconnect(); s.term.dispose(); s.el.remove();
        document.querySelector(`.tabx[data-id="${sid}"]`).remove();
        delete sessions[sid];
        const remaining = Object.keys(sessions);
        if (remaining.length > 0) switchSession(remaining[remaining.length - 1]);
        else {
            activeSessionId = null;
            document.getElementById('welcome-screen').style.display = 'flex';
            document.getElementById('status-server-name').innerText = `无活动会话`;
        }
    }

    function initResizer(container) {
        const resizer = container.querySelector('.resizer');
        const sftpRow = container.querySelector('.sftp-row');
        if (!resizer || !sftpRow) return;

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startY = e.clientY, startHeight = sftpRow.offsetHeight;
            const onMouseMove = (moveEvent) => {
                const newHeight = startHeight - (moveEvent.clientY - startY);
                if (newHeight > 40 && newHeight < container.offsetHeight * 0.9) {
                    sftpRow.style.height = `${newHeight}px`;
                    sftpRow.style.flex = 'none';
                    const sid = container.id.replace('page-', '');
                    if (sessions[sid]?.fit) sessions[sid].fit.fit();
                }
            };
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    function initResizers() {
        const app = document.getElementById('nexus-app');
        const sidebar = document.querySelector('.side-nav');
        const left = document.querySelector('.left-v-resizer');
        const right = document.querySelector('.right-v-resizer');

        if (!left || !right || !sidebar) {
            console.error("Resizer elements not found");
            return;
        }

        const handleResize = (e, type) => {
            document.body.classList.add('resizing-active');
            
            const onMouseMove = (m) => {
                if (type === 'left') {
                    const sbWidth = sidebar.offsetWidth;
                    let w = m.clientX - sbWidth;
                    if (w > 150 && w < 600) {
                        app.style.setProperty('--explorer-width', `${w}px`);
                    }
                } else {
                    let w = window.innerWidth - m.clientX;
                    if (w > 200 && w < window.innerWidth * 0.6) {
                        app.style.setProperty('--ai-panel-width', `${w}px`);
                    }
                }
                window.dispatchEvent(new Event('resize'));
            };

            const onMouseUp = () => {
                document.body.classList.remove('resizing-active');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        left.onmousedown = (e) => { e.preventDefault(); handleResize(e, 'left'); };
        right.onmousedown = (e) => { e.preventDefault(); handleResize(e, 'right'); };

        const closeBtn = document.getElementById('close-ai-panel');
        if (closeBtn) closeBtn.onclick = () => toggleAI(false);
        
        const fab = document.getElementById('ai-fab');
        if (fab) fab.onclick = () => toggleAI(true);
    }

    window.toggleAI = function(show = null) {
        const app = document.getElementById('nexus-app');
        const fab = document.getElementById('ai-fab');
        if (!app || !fab) return;

        const isCurrentlyCollapsed = app.classList.contains('ai-collapsed');
        
        // If show is null, we want to TOGGLE. 
        // If isCurrentlyCollapsed is true (hidden), targetShow should be true (to show).
        // If isCurrentlyCollapsed is false (shown), targetShow should be false (to hide).
        const targetShow = (show !== null) ? show : isCurrentlyCollapsed;
        
        console.log(`[UI] toggleAI: current=${!isCurrentlyCollapsed}, targetShow=${targetShow}`);

        if (targetShow) {
            app.classList.remove('ai-collapsed');
            fab.classList.remove('visible');
        } else {
            app.classList.add('ai-collapsed');
            fab.classList.add('visible');
        }
        
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
            safeCreateIcons();
        }, 400); // Wait for transition
    };

    // --- 资产管理 ---
    async function loadServers() {
        const res = await fetch('/api/servers');
        const servers = await res.json();
        
        // 核心修复：确保只有在处于 Ops 模块时才更新侧边栏内容，防止竞态覆盖
        const activeNav = document.querySelector('.nav-item.active');
        if (!activeNav || activeNav.dataset.module !== 'ops') return;

        const tree = document.getElementById('sidebar-content');
        if (!tree) return;
        
        const groups = {};
        servers.forEach(s => { (groups[s.group || '默认'] = groups[s.group || '默认'] || []).push(s); });
        
        let html = '<ul class="tree-list">';
        for (const [name, list] of Object.entries(groups)) {
            html += `<li class="folder open">
                <div class="group-header"><i data-lucide="chevron-down"></i> ${name}</div>
                <div class="sub-tree">
                    ${list.map(s => `
                        <div class="server-item" data-server='${JSON.stringify(s)}'>
                            <div style="display:flex; align-items:center">
                                <i data-lucide="monitor"></i> <span>${s.name}</span>
                            </div>
                            <div class="server-actions">
                                <i data-lucide="edit-3" class="action-icon edit"></i>
                                <i data-lucide="trash-2" class="action-icon delete"></i>
                            </div>
                        </div>`).join('')}
                </div></li>`;
        }
        tree.innerHTML = html + '</ul>';
        safeCreateIcons();
    }

    function showServerModal(server = null) {
        const m = document.getElementById('server-modal');
        const form = document.getElementById('server-form');
        form.reset();
        if (server) {
            ['s-id','s-name','s-ip','s-port','s-user','s-group'].forEach(id => {
                const val = (id==='s-id'?server.id : id==='s-port'?server.port : id==='s-user'?server.username : server[id.split('-')[1]]);
                document.getElementById(id).value = val || '';
            });
            m.querySelector('.modal-header h3').innerText = '编辑服务器';
        } else {
            document.getElementById('s-id').value = '';
            m.querySelector('.modal-header h3').innerText = '添加新服务器';
        }
        m.classList.add('open');
        safeCreateIcons();
    }

    async function handleSaveServer() {
        const sid = document.getElementById('s-id').value;
        const data = {
            name: document.getElementById('s-name').value,
            ip: document.getElementById('s-ip').value,
            port: parseInt(document.getElementById('s-port').value || 22),
            username: document.getElementById('s-user').value || 'root',
            password: document.getElementById('s-pass').value,
            group: document.getElementById('s-group').value || '默认'
        };
        const res = await fetch(sid ? `/api/servers/${sid}` : '/api/servers', {
            method: sid ? 'PUT' : 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            if (sid) {
                // 如果是编辑，关闭弹窗
                document.getElementById('server-modal').classList.remove('open');
            } else {
                // 如果是新增，清空表单以便继续添加 (保留分组，方便批量录入相同分组的服务器)
                const group = document.getElementById('s-group').value;
                document.getElementById('server-form').reset();
                document.getElementById('s-group').value = group;
                
                // 给个控制台或轻量反馈 (此处可通过界面元素提示，暂保持简洁)
                console.log("[UI] Server added, keeping modal open for next entry.");
            }
            loadServers();
        }
    }

    async function handleDeleteServer(server) {
        if (confirm(`确认删除 ${server.name}？`)) {
            const res = await fetch(`/api/servers/${server.id}`, { method: 'DELETE' });
            if ((await res.json()).success) loadServers();
        }
    }

    // --- 模块切换 ---
    function switchModule(module) {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        const navItem = document.querySelector(`.nav-item[data-module="${module}"]`);
        if (navItem) navItem.classList.add('active');

        const sidebarTitle = document.getElementById('sidebar-title');
        const sidebarContent = document.getElementById('sidebar-content');
        const addBtn = document.getElementById('add-server-btn');
        const welcome = document.getElementById('welcome-screen');
        
        const titles = { 
            'ops':'运维资产',
            'check':'自动化任务',
            'monitor':'性能监控',
            'scripts':'脚本控制台',
            'kb':'文档知识库',
            'settings':'全局系统设置' 
        };
        if (sidebarTitle) sidebarTitle.innerText = titles[module] || 'Nexus';
        addBtn.style.display = (module === 'ops') ? 'flex' : 'none';

        // 清除旧模块容器
        const existing = document.getElementById('module-container');
        if (existing) existing.remove();

        // 首页/资产模块特殊逻辑
        if (module === 'ops') {
            loadServers();
            welcome.style.display = activeSessionId ? 'none' : 'flex';
            document.getElementById('tab-bar').style.display = 'flex';
            if (activeSessionId) {
                document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === `page-${activeSessionId}`));
            }
        } else {
            welcome.style.display = 'none';
            document.getElementById('tab-bar').style.display = 'none';
            document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
            
            // 渲染模块侧边栏和主界面
            renderModuleSidebar(module);
            renderModule(module);
        }
    }

    function renderModuleSidebar(module) {
        const sidebarContent = document.getElementById('sidebar-content');
        if (!sidebarContent) return;
        
        if (module === 'check') {
            sidebarContent.innerHTML = `
                <div class="auto-sidebar">
                    <div class="auto-nav-item active" data-sub="execute">
                        <i data-lucide="terminal"></i> 远程执行
                    </div>
                    <div class="auto-nav-item" data-sub="scripts">
                        <i data-lucide="code-2"></i> 脚本管理
                    </div>
                    <div class="auto-nav-item" data-sub="distribute">
                        <i data-lucide="share-2"></i> 文件分发
                    </div>
                    <div class="auto-nav-item" data-sub="cron">
                        <i data-lucide="clock"></i> 定时任务
                    </div>
                    <div class="auto-nav-item" data-sub="inspect">
                        <i data-lucide="shield-check"></i> 系统巡检
                    </div>
                </div>
            `;
            
            // 绑定子菜单切换
            sidebarContent.querySelectorAll('.auto-nav-item').forEach(item => {
                item.onclick = (e) => {
                    sidebarContent.querySelectorAll('.auto-nav-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                    const sub = item.getAttribute('data-sub');
                    const container = document.getElementById('module-container');
                    if (container) renderAutomationSub(sub, container);
                };
            });
        } else {
            const content = {
                'monitor': `<div class="sidebar-placeholder" style="padding:40px 20px; text-align:center; color:#5c6370"><i data-lucide="activity" style="width:32px; height:32px; margin-bottom:15px; opacity:0.3"></i><div style="font-size:12px">资源监控分组</div></div>`,
                'scripts': `<div class="sidebar-placeholder" style="padding:40px 20px; text-align:center; color:#5c6370"><i data-lucide="code-2" style="width:32px; height:32px; margin-bottom:15px; opacity:0.3"></i><div style="font-size:12px">脚本库分类</div></div>`
            };
            sidebarContent.innerHTML = content[module] || `<div class="sidebar-placeholder" style="padding:40px 20px; text-align:center; color:#5c6370">无可用菜单</div>`;
        }
        safeCreateIcons();
    }

    function renderModule(module) {
        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;

        const container = document.createElement('div');
        container.id = 'module-container'; 
        container.className = 'module-view';
        mainContent.appendChild(container);
        
        if (module === 'check') {
            renderAutomationSub('execute', container);
        } else if (module === 'monitor') {
            renderMonitor(container);
        } else if (module === 'scripts') {
            renderScripts(container);
        } else if (module === 'kb') {
            renderKB(container);
        } else if (module === 'settings') {
            renderSettings(container);
        }
        
        safeCreateIcons();
    }

    async function renderCheck(container) {
        container.innerHTML = `<div class="monitor-dashboard"><h2>巡检任务</h2><p style="color:#636d83">暂无正在运行的任务</p></div>`;
    }

    async function renderMonitor(container) {
        container.innerHTML = `<div class="monitor-dashboard"><h2>实时资源监控</h2><div class="metrics-grid" id="monitor-grid"></div></div>`;
        const res = await fetch('/api/servers');
        const servers = await res.json();
        const grid = document.getElementById('monitor-grid');
        servers.forEach(s => {
            const card = document.createElement('div');
            card.className = 'metric-card'; card.id = `card-${s.id}`;
            card.innerHTML = `<h4>${s.name}</h4><div class="metric-item" style="color:#abb2bf; font-size:12px">CPU 负载: <span class="cpu-v">-</span>% <div class="progress-bar" style="margin-top:5px"><div class="fill cpu-f"></div></div></div>`;
            grid.appendChild(card);
            setInterval(async () => {
                try {
                    const r = await fetch(`/api/monitoring/${s.id}`);
                    const {data} = await r.json();
                    if (data) {
                        card.querySelector('.cpu-v').innerText = data.cpu_usage;
                        card.querySelector('.cpu-f').style.width = data.cpu_usage+'%';
                    }
                } catch(e) {}
            }, 3000);
        });
    }

    function renderScripts(container) {
        container.innerHTML = `<div class="monitor-dashboard"><h2>脚本库</h2><p style="color:#636d83">初始化中...</p></div>`;
    }

    function renderKB(container) {
        container.innerHTML = `<div class="monitor-dashboard"><h2>知识库</h2><p style="color:#636d83">搜索文档...</p></div>`;
    }

    // --- 设置 & AI 模型管理 ---
    async function renderSettings(container) {
        const sidebar = document.getElementById('sidebar-content');
        sidebar.innerHTML = `
            <div class="auto-sidebar">
                <div class="auto-nav-item active" data-cat="account"><i data-lucide="user"></i> 个人账号 </div>
                <div class="auto-nav-item" data-cat="general"><i data-lucide="settings"></i> 通用设置 </div>
                <div class="auto-nav-item" data-cat="theme"><i data-lucide="palette"></i> 外观主题 </div>
                <div class="auto-nav-item" data-cat="model"><i data-lucide="brain-circuit"></i> 模型配置 </div>
            </div>`;
        safeCreateIcons();
        sidebar.querySelectorAll('.auto-nav-item').forEach(item => {
            item.onclick = () => {
                sidebar.querySelectorAll('.auto-nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                renderSettingsForm(item.dataset.cat, container);
            };
        });
        renderSettingsForm('account', container);
    }

    async function renderSettingsForm(cat, container) {
        if (cat === 'account') {
            container.innerHTML = `<div class="settings-view">
                <h2>个人账号</h2>
                <div class="settings-group">
                    <div style="display:flex; align-items:center; padding:20px 0">
                        <div class="avatar-large" style="width:72px; height:72px; font-size:28px; color:white">F</div>
                        <div style="margin-left:32px">
                            <div style="font-size:24px; font-weight:600; color:var(--text-bright)">FuQian <span class="pro-badge" style="background:linear-gradient(135deg, #f39c12, #f1c40f); margin-left:12px">PLATINUM</span></div>
                            <div style="color:var(--text-muted); font-size:14px; margin-top:8px">系统超级管理员 | root@nexus.local</div>
                        </div>
                    </div>
                </div>
                <div class="settings-group" style="border-top:1px solid var(--border-glass); padding-top:24px">
                    <div class="settings-info"><label>安全与合规</label><p>您的账号受双重身份验证 (2FA) 保护</p></div>
                    <div style="margin-top:16px; font-size:12px; color:var(--text-muted)">
                        <p>最后登录位置: 上海, 中国</p>
                        <p style="margin-top:6px">登录时间: 2026-03-30 16:45:12</p>
                    </div>
                </div>
            </div>`;
        } else if (cat === 'general') {
            container.innerHTML = `<div class="settings-view">
                <h2>通用配置</h2>
                <div class="settings-group">
                    <div class="settings-row">
                        <div class="settings-info"><label>界面语言 (Language)</label><p>切换系统显示语言，重启后生效</p></div>
                        <select class="settings-select"><option>简体中文</option><option>English</option></select>
                    </div>
                    <div class="settings-row">
                        <div class="settings-info"><label>终端缓冲区 (Scrollback)</label><p>设置终端实时保存的历史行数</p></div>
                        <input type="number" class="settings-input" value="1000" style="width:100px">
                    </div>
                    <div class="settings-row">
                        <div class="settings-info"><label>代码自动保存</label><p>编辑器失去焦点时自动保存修改</p></div>
                        <label class="switch-container"><input type="checkbox" checked><span class="switch-slider"></span></label>
                    </div>
                </div>
            </div>`;
        } else if (cat === 'theme') {
            container.innerHTML = `<div class="settings-view">
                <h2>外观偏好</h2>
                <div class="settings-group">
                    <div class="settings-row">
                        <div class="settings-info"><label>全局主题颜色</label><p>选择您喜欢的视觉模式，包含亮黑与清爽</p></div>
                        <select class="settings-select" id="theme-selector" style="width:140px">
                            <option value="dark">亮黑 (Dark Mode)</option>
                            <option value="light">清爽 (Bright Mode)</option>
                        </select>
                    </div>
                    <div class="settings-row">
                        <div class="settings-info"><label>资产栏默认宽度</label><p>调整左侧资源管理器初始显示像素</p></div>
                        <div style="display:flex; align-items:center; gap:10px">
                            <input type="number" class="settings-input" value="260" style="width:80px">
                            <span style="font-size:12px; color:var(--text-muted)">PX</span>
                        </div>
                    </div>
                </div>
            </div>`;
            const sel = document.getElementById('theme-selector');
            sel.value = document.body.classList.contains('theme-light') ? 'light' : 'dark';
            sel.onchange = (e) => {
                document.body.classList.toggle('theme-light', e.target.value === 'light');
            };
        } else if (cat === 'model') {
            const res = await fetch('/api/models');
            aiModels = await res.json();
            container.innerHTML = `
                <div class="settings-view">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px">
                        <div>
                            <h2>AI 模型管理</h2>
                            <p>配置模型供应商，支持多模型智能切换</p>
                        </div>
                        <button class="btn-confirm-sm" id="open-add-model">+ 添加模型</button>
                    </div>
                    <div class="auto-card" style="padding:0; overflow-x:auto">
                        <table class="model-table" style="width:100%">
                            <thead><tr>
                                <th>显示名称</th><th>供应商</th><th>基础模型</th><th>状态</th><th>操作</th>
                            </tr></thead>
                            <tbody id="model-list-body">
                                ${aiModels.map(m => `
                                    <tr>
                                        <td style="font-weight:600">${m.name}</td>
                                        <td>${m.provider}</td>
                                        <td style="font-family:var(--font-mono); font-size:11px">${m.model_name}</td>
                                        <td><span class="status-badge" style="background:${m.is_active?'rgba(46,204,113,0.1)':'rgba(92,99,112,0.1)'}; color:${m.is_active?'#2ecc71':'#636d83'}">${m.is_active?'活动':'闲置'}</span></td>
                                        <td>
                                            <div style="display:flex; gap:15px; align-items:center">
                                                ${!m.is_active ? `<i data-lucide="check-circle" class="act-model" data-id="${m.id}" title="激活" style="cursor:pointer; width:14px; color:var(--accent-blue)"></i>` : ''}
                                                <i data-lucide="edit-3" class="edit-model" data-id="${m.id}" title="编辑" style="cursor:pointer; width:14px"></i>
                                                <i data-lucide="trash-2" class="del-model" data-id="${m.id}" style="color:#e06c75; cursor:pointer; width:14px" title="删除"></i>
                                            </div>
                                        </td>
                                    </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>`;
            
            container.querySelector('#open-add-model').onclick = () => showAIModelModal();
            container.querySelectorAll('.act-model').forEach(i => i.onclick = () => activateAIModel(i.dataset.id));
            container.querySelectorAll('.edit-model').forEach(i => i.onclick = () => {
                const m = aiModels.find(x => x.id == i.dataset.id);
                showAIModelModal(m);
            });
            container.querySelectorAll('.del-model').forEach(i => i.onclick = () => deleteAIModel(i.dataset.id));
        }
        safeCreateIcons();
    }

    function showAIModelModal(m = null) {
        const modal = document.getElementById('model-config-modal');
        ['modal-ai-id','modal-ai-name','modal-ai-provider','modal-ai-url','modal-ai-key','modal-ai-model'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = m ? (id==='modal-ai-id'?m.id : id==='modal-ai-name'?m.name : id==='modal-ai-provider'?m.provider : id==='modal-ai-url'?m.base_url : id==='modal-ai-key'?m.api_key : m.model_name) : '';
        });
        modal.style.display = 'flex';
        safeCreateIcons();
    }

    function closeModelModal() { document.getElementById('model-config-modal').style.display = 'none'; }

    async function handleSaveAIModel() {
        const id = document.getElementById('modal-ai-id').value;
        const data = {
            name: document.getElementById('modal-ai-name').value,
            provider: document.getElementById('modal-ai-provider').value,
            base_url: document.getElementById('modal-ai-url').value,
            api_key: document.getElementById('modal-ai-key').value,
            model_name: document.getElementById('modal-ai-model').value
        };
        const res = await fetch(id ? `/api/models/${id}` : '/api/models', {
            method: id ? 'PUT' : 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if ((await res.json()).success) {
            closeModelModal();
            updateModelSelector();
        document.querySelector('.auto-nav-item.active')?.click();
        }
    }

    async function activateAIModel(id) {
        await fetch('/api/models', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'activate', id })
        });
        document.querySelector('.auto-nav-item.active')?.click();
        if (confirm("确定删除此模型？")) {
            await fetch(`/api/models/${id}`, { method: 'DELETE' });
            updateModelSelector();
            document.querySelector('.auto-nav-item.active')?.click();
        }
    }

    // --- AI 聊天 ---
    const chatInput = document.getElementById('chat-input'), sendBtn = document.getElementById('send-chat'), chatBox = document.getElementById('chat-messages');

    async function updateModelSelector() {
        const sel = document.getElementById('ai-model-selector');
        if (!sel) return;
        const res = await fetch('/api/models');
        const models = await res.json();
        sel.innerHTML = models.map(m => `<option value="${m.id}" ${m.is_active?'selected':''}>${m.name}</option>`).join('');
    }

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;
        
        chatBox.insertAdjacentHTML('beforeend', `<div class="message user"><div class="message-avatar">U</div><div class="bubble">${text}</div></div>`);
        chatInput.value = ''; chatBox.scrollTop = chatBox.scrollHeight;
        
        const loadingId = 'ai-' + Date.now();
        // 核心优化：加载状态即展示头像，提升等待体验
        chatBox.insertAdjacentHTML('beforeend', `
            <div class="message ai" id="${loadingId}">
                <div class="message-avatar"><i data-lucide="bot"></i></div>
                <div class="bubble">
                    <div class="loading-dots">
                        <span>.</span><span>.</span><span>.</span>
                    </div>
                </div>
            </div>`);
        safeCreateIcons();
        chatBox.scrollTop = chatBox.scrollHeight;
        
        const mid = document.getElementById('ai-model-selector').value;
        const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ message: text, model_id: mid })
        });
        const data = await res.json();
        
        // 使用 marked.js 渲染 Markdown，确保脚本显示清晰
        const rawContent = data.reply || data.error || '无返回内容';
        const formatted = window.marked ? window.marked.parse(rawContent) : rawContent;
        
        // 替换气泡内容，保持头像一致
        document.getElementById(loadingId).innerHTML = `
            <div class="message-avatar"><i data-lucide="bot"></i></div>
            <div class="bubble">${formatted}</div>`;
        safeCreateIcons();
        
        // 渲染代码高亮
        if (window.hljs) {
            document.getElementById(loadingId).querySelectorAll('pre code').forEach((el) => {
                window.hljs.highlightElement(el);
            });
        }
        
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    if (sendBtn) {
        sendBtn.onclick = sendMessage;
        chatInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
        updateModelSelector();
    }

    // --- 自动化任务子模块渲染 ---
    async function renderAutomationSub(sub, container = null) {
        const target = container || document.getElementById('module-container');
        if (!target) return;
        
        // 移除加载闪烁，直接进行渲染切换
        if (sub === 'execute') renderRemoteExecution(target);
        else if (sub === 'scripts') renderScriptManagement(target);
        else if (sub === 'distribute') renderFileDistribution(target);
        else if (sub === 'cron') renderScheduledTasks(target);
        else if (sub === 'inspect') renderSystemInspection(target);
    }

    async function renderRemoteExecution(container) {
        const [srvRes, scpRes] = await Promise.all([
            fetch('/api/servers'),
            fetch('/api/scripts')
        ]);
        const servers = await srvRes.json();
        const scripts = await scpRes.json();
        
        container.innerHTML = `
            <div class="automation-view">
                <div class="auto-header">
                    <h2><i data-lucide="terminal" style="margin-right:10px"></i> 远程执行</h2>
                    <p>在多台服务器上批量运行指令并实时获取输出</p>
                </div>
                
                <div class="auto-card" style="margin-top:24px">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px">
                        <div style="font-weight:600; font-size:13px; color:var(--text-bright)">1. 选择目标节点</div>
                        <button class="icon-button" id="select-all-nodes" title="全选/取消全选" style="font-size:10px; width:auto; padding:0 8px">全选</button>
                    </div>
                    <div id="exec-node-selector"></div>
                </div>

                <div class="auto-card" style="margin-top:20px">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px">
                        <div style="font-weight:600; font-size:13px; color:var(--text-bright)">2. 执行脚本或指令</div>
                        <div style="display:flex; align-items:center; gap:10px">
                            <span style="font-size:11px; color:var(--text-muted)">快速导入:</span>
                            <select id="auto-script-picker" class="model-mini-select">
                                <option value="">-- 手动编辑 --</option>
                                ${scripts.map(s => `<option value="${encodeURIComponent(s.content)}">${s.name}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <textarea id="auto-cmd-input" placeholder="输入命令，按 Cmd+Enter 快速运行..." style="width:100%; height:140px; background:var(--bg-input); border:1px solid var(--border-color); color:var(--text-bright); padding:15px; border-radius:10px; font-family:var(--font-mono); outline:none; font-size:13px; line-height:1.6"></textarea>
                    <div style="margin-top:20px; display:flex; justify-content:flex-end; gap:12px">
                         <div style="flex:1; font-size:11px; color:var(--text-muted); display:flex; align-items:center">
                            <i data-lucide="info" style="width:12px; margin-right:6px"></i> 支持并行分发执行
                         </div>
                        <button class="btn-confirm" id="run-auto-exec" style="padding:10px 32px">
                            <i data-lucide="play" style="width:14px; margin-right:8px"></i> 运行任务
                        </button>
                    </div>
                </div>

                <div id="auto-exec-results" style="margin-top:24px"></div>
            </div>`;
        
        renderNodeSelection(servers, 'exec-node-selector');

        const selectAllBtn = container.querySelector('#select-all-nodes');
        selectAllBtn.onclick = () => {
            const cards = container.querySelectorAll('.node-card');
            const allSelected = Array.from(cards).every(c => c.classList.contains('selected'));
            cards.forEach(c => {
                if (allSelected) {
                    c.classList.remove('selected');
                    c.querySelector('.node-hidden-cb').checked = false;
                } else {
                    c.classList.add('selected');
                    c.querySelector('.node-hidden-cb').checked = true;
                }
            });
        };
        
        safeCreateIcons();

        // 绑定脚本选择器
        const picker = container.querySelector('#auto-script-picker');
        const input = container.querySelector('#auto-cmd-input');
        picker.onchange = () => {
            if (picker.value) {
                input.value = decodeURIComponent(picker.value);
            }
        };
        
        container.querySelector('#run-auto-exec').onclick = async () => {
            const selected = Array.from(container.querySelectorAll('.node-hidden-cb:checked')).map(cb => cb.value);
            const cmd = container.querySelector('#auto-cmd-input').value.trim();
            if (selected.length === 0) return alert("请至少选择一台服务器");
            if (!cmd) return alert("请输入命令");
            
            const resultsBox = container.querySelector('#auto-exec-results');
            resultsBox.innerHTML = `<div style="padding:20px; text-align:center; color:#636d83">正在并行分发任务至 ${selected.length} 个节点...</div>`;
            
            const res = await fetch('/api/automation/execute', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ server_ids: selected, command: cmd })
            });
            const data = await res.json();
            
            resultsBox.innerHTML = `
                <div style="margin-bottom:15px; font-weight:600; font-size:14px; border-bottom:1px solid var(--border-color); padding-bottom:8px">执行报告</div>
                <div class="results-list" style="display:flex; flex-direction:column; gap:12px">
                    ${Object.entries(data.results).map(([sid, res]) => {
                        // 鲁棒性匹配：支持 string 和 number 类型的 ID
                        const s = servers.find(x => String(x.id) === String(sid));
                        return `
                            <div class="result-card" style="background:var(--bg-side); border:1px solid ${res.success?'rgba(46,204,113,0.15)':'rgba(224,108,117,0.15)'}; border-radius:8px; overflow:hidden">
                                <div class="result-card-header" style="background:${res.success?'rgba(46,204,113,0.05)':'rgba(224,108,117,0.05)'}; padding:10px 15px; display:flex; justify-content:space-between; align-items:center">
                                    <div style="display:flex; align-items:center; gap:8px">
                                        <i data-lucide="monitor" style="width:14px"></i>
                                        <span style="font-weight:600; font-size:13px">${s ? s.name : '未知节点 (' + sid + ')'}</span>
                                    </div>
                                    <span class="res-tag" style="font-size:11px; font-weight:700; color:${res.success?'#2ecc71':'#e06c75'}">${res.success ? 'SUCCESS' : 'FAILURE'}</span>
                                </div>
                                <pre class="result-output" style="margin:0; padding:15px; background:rgba(0,0,0,0.2); font-size:12px; color:var(--text-main); white-space:pre-wrap; max-height:300px; overflow-y:auto">${res.output || '无输出信息'}</pre>
                            </div>`;
                    }).join('')}
                </div>`;
            safeCreateIcons();
        };
    }

    async function renderScriptManagement(container) {
        const res = await fetch('/api/scripts');
        const scripts = await res.json();
        
        container.innerHTML = `
            <div class="automation-view">
                <div class="auto-header" style="display:flex; justify-content:space-between; align-items:center">
                    <div>
                        <h2><i data-lucide="code-2" style="margin-right:10px"></i> 脚本管理</h2>
                        <p>维护常用的 Shell/Python 脚本库，支持一键分发运行</p>
                    </div>
                    <button class="btn-confirm" id="add-script-btn">+ 新增脚本库</button>
                </div>
                
                <div class="script-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:24px; margin-top:30px">
                    ${scripts.map(s => `
                        <div class="script-card-v2">
                            <div class="card-banner">
                                <div class="script-type">${s.type}</div>
                                <div style="display:flex; gap:8px">
                                    <button class="icon-button script-edit-wrap" data-id="${s.id}" title="编辑"><i data-lucide="edit-3"></i></button>
                                    <button class="icon-button script-del-wrap" data-id="${s.id}" title="删除" style="color:#f43f5e"><i data-lucide="trash-2"></i></button>
                                </div>
                            </div>
                            <div class="card-body">
                                <h3>${s.name}</h3>
                                <div class="desc">${s.description || '暂无详细描述'}</div>
                            </div>
                            <div class="card-footer">
                                <div style="font-size:11px; color:var(--text-muted)">
                                    <i data-lucide="clock" style="width:10px; margin-right:4px"></i> 常用
                                </div>
                                <button class="btn-confirm-sm script-run" data-id="${s.id}" data-content="${encodeURIComponent(s.content)}" style="padding:6px 16px; font-size:11px">
                                    <i data-lucide="play" style="width:12px; margin-right:6px"></i> 立即执行
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        safeCreateIcons();

        safeCreateIcons();
    }

    function showScriptModal(script = null, container) {
        const modal = document.getElementById('script-config-modal');
        document.getElementById('modal-script-id').value = script ? script.id : '';
        document.getElementById('modal-script-name').value = script ? script.name : '';
        document.getElementById('modal-script-type').value = script ? script.type : 'shell';
        document.getElementById('modal-script-content').value = script ? script.content : '';
        document.getElementById('modal-script-desc').value = script ? (script.description||'') : '';
        
        modal.style.display = 'flex';
        safeCreateIcons();

        document.getElementById('close-script-modal').onclick = () => modal.style.display = 'none';
        document.getElementById('cancel-script-btn').onclick = () => modal.style.display = 'none';
        
        document.getElementById('save-script-modal-btn').onclick = async () => {
            const sid = document.getElementById('modal-script-id').value;
            const data = {
                name: document.getElementById('modal-script-name').value,
                type: document.getElementById('modal-script-type').value,
                content: document.getElementById('modal-script-content').value,
                description: document.getElementById('modal-script-desc').value
            };
            const method = sid ? 'PUT' : 'POST';
            const url = sid ? `/api/scripts/${sid}` : '/api/scripts';
            
            const res = await fetch(url, {
                method,
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            });
            if (res.ok) {
                modal.style.display = 'none';
                renderScriptManagement(container);
            }
        };
    }

    async function renderFileDistribution(container) {
        const res = await fetch('/api/servers');
        const servers = await res.json();

        container.innerHTML = `
            <div class="automation-view">
                <div class="auto-header">
                    <h2><i data-lucide="share-2" style="margin-right:10px"></i> 文件分发</h2>
                    <p>将本地文件批量同步至多台目标服务器指定目录</p>
                </div>
                
                <div class="auto-card" style="margin-top:24px">
                    <div style="margin-bottom:15px; font-weight:600; font-size:13px; color:var(--text-bright)">1. 资产与路径配置</div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px">
                        <div class="file-upload-zone" id="dist-file-drop" style="border:2px dashed var(--border-color); border-radius:12px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px; background:var(--bg-main); transition:all 0.3s; cursor:pointer">
                            <i data-lucide="upload-cloud" style="width:40px; height:40px; color:var(--accent-blue); margin-bottom:12px; opacity:0.6"></i>
                            <div style="font-size:13px; color:var(--text-bright)" id="dist-file-name">点击或拖拽文件到此处</div>
                            <div style="font-size:11px; color:var(--text-muted); margin-top:6px">支持单个大文件极速推送</div>
                            <input type="file" id="dist-file-input" style="display:none">
                        </div>
                        <div style="display:flex; flex-direction:column; gap:20px">
                            <div>
                                <label style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:8px; text-transform:uppercase">远程目标路径</label>
                                <input type="text" id="dist-remote-path" value="/tmp/" placeholder="/home/nexus/deploy/" style="width:100%; background:var(--bg-input); border:1px solid var(--border-color); color:var(--text-bright); padding:12px; border-radius:8px; font-family:var(--font-mono); outline:none; font-size:13px">
                            </div>
                            <div style="background:var(--bg-hover); border-radius:8px; padding:12px; display:flex; align-items:flex-start; gap:10px">
                                <i data-lucide="alert-circle" style="width:14px; color:var(--accent-blue); flex-shrink:0; margin-top:2px"></i>
                                <span style="font-size:11px; color:var(--text-muted); line-height:1.5">系统将自动检测目标路径是否存在，若不存在则尝试静默创建。请确保 SSH 用户具有写入权限。</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="auto-card" style="margin-top:20px">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px">
                        <div style="font-weight:600; font-size:13px; color:var(--text-bright)">2. 选择目标分发节点</div>
                        <button class="icon-button" id="dist-select-all" style="font-size:10px; width:auto; padding:0 8px">全选</button>
                    </div>
                    <div id="dist-node-selector"></div>
                </div>

                <div style="margin-top:30px; display:flex; justify-content:center">
                    <button class="btn-confirm" id="start-distrate-btn" style="padding:14px 60px; font-size:14px; font-weight:600; letter-spacing:1px">
                        <i data-lucide="zap" style="width:16px; margin-right:10px"></i> 启动并行分发任务
                    </button>
                </div>

                <div id="distrate-results" style="margin-top:30px"></div>
            </div>`;
        
        renderNodeSelection(servers, 'dist-node-selector');

        const selectAllBtn = container.querySelector('#dist-select-all');
        selectAllBtn.onclick = () => {
            const cards = container.querySelectorAll('.node-card');
            const allSelected = Array.from(cards).every(c => c.classList.contains('selected'));
            cards.forEach(c => {
                if (allSelected) {
                    c.classList.remove('selected');
                    c.querySelector('.node-hidden-cb').checked = false;
                } else {
                    c.classList.add('selected');
                    c.querySelector('.node-hidden-cb').checked = true;
                }
            });
        };
        
        safeCreateIcons();

        const dropZone = container.querySelector('#dist-file-drop');
        const fileInput = container.querySelector('#dist-file-input');
        const fileNameDisp = container.querySelector('#dist-file-name');
        
        dropZone.onclick = () => fileInput.click();
        fileInput.onchange = () => {
            if (fileInput.files.length) {
                fileNameDisp.innerText = `已选择: ${fileInput.files[0].name}`;
                dropZone.style.borderColor = '#4d8df6';
                dropZone.style.background = 'rgba(77, 141, 246, 0.05)';
            }
        };

        container.querySelector('#start-distrate-btn').onclick = async () => {
            const file = fileInput.files[0];
            const remotePath = container.querySelector('#dist-remote-path').value.trim();
            const serverIds = Array.from(container.querySelectorAll('.node-hidden-cb:checked')).map(cb => cb.value);
            const resultsBox = container.querySelector('#distrate-results');

            if (!file) return alert("请先选择要分发的文件");
            if (!remotePath) return alert("请输入目标路径");
            if (serverIds.length === 0) return alert("请选择至少一台目标服务器");

            resultsBox.innerHTML = `<div style="padding:20px; text-align:center; color:#5c6370"><i data-lucide="loader-2" class="spin" style="margin-right:10px"></i> 正在建立加密通道并推送文件...</div>`;
            safeCreateIcons();

            const formData = new FormData();
            formData.append('file', file);
            formData.append('remote_path', remotePath);
            serverIds.forEach(id => formData.append('server_ids[]', id));

            try {
                const res = await fetch('/api/automation/distribute', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                
                resultsBox.innerHTML = `
                    <div style="font-weight:600; font-size:14px; margin-bottom:15px; display:flex; align-items:center; gap:8px">
                        分发报告 <span style="font-size:12px; font-weight:400; color:#5c6370">(${file.name} -> ${remotePath})</span>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px">
                        ${Object.entries(data.results).map(([sid, r]) => {
                            const s = servers.find(x => String(x.id) === String(sid));
                            return `
                                <div style="background:var(--bg-side); border:1px solid ${r.success?'rgba(46,204,113,0.2)':'rgba(224,108,117,0.2)'}; border-radius:8px; padding:12px">
                                    <div style="display:flex; justify-content:space-between; align-items:center">
                                        <div style="display:flex; align-items:center; gap:8px">
                                            <i data-lucide="server" style="width:14px; color:${r.success?'#2ecc71':'#e06c75'}"></i>
                                            <span style="font-weight:600; font-size:13px">${s ? s.name : '未知节点'}</span>
                                        </div>
                                        <span style="font-size:10px; font-weight:700; color:${r.success?'#2ecc71':'#e06c75'}">${r.success?'DONE':'FAIL'}</span>
                                    </div>
                                    <div style="font-size:11px; color:#5c6370; margin-top:8px">${r.message || r.error}</div>
                                </div>`;
                        }).join('')}
                    </div>`;
                safeCreateIcons();
            } catch (err) {
                resultsBox.innerHTML = `<div style="color:#e06c75; padding:10px">分发任务执行失败: ${err.message}</div>`;
            }
        };
    }

    async function renderScheduledTasks(container) {
        const [taskRes, srvRes] = await Promise.all([
            fetch('/api/automation/tasks'),
            fetch('/api/servers')
        ]);
        const tasks = await taskRes.json();
        const servers = await srvRes.json();

        container.innerHTML = `
            <div class="automation-view">
                <div class="auto-header" style="display:flex; justify-content:space-between; align-items:center">
                    <div>
                        <h2><i data-lucide="clock" style="margin-right:10px"></i> 定时任务</h2>
                        <p>基于 Cron 表达式的周期性自动化作业管理</p>
                    </div>
                    <button class="btn-confirm" id="add-task-btn">+ 创建自动化任务</button>
                </div>
                
                <div class="auto-card" style="margin-top:24px; padding:0; overflow:hidden; border:1px solid var(--border-glass)">
                    <table class="sftp-table" style="width:100%; table-layout:fixed; min-width:850px">
                        <thead style="background:rgba(0,0,0,0.1)">
                            <tr>
                                <th style="text-align:left; padding-left:24px; width:160px">任务标识</th>
                                <th style="width:180px">目标节点群</th>
                                <th style="width:240px">执行指令预览</th>
                                <th style="width:140px">调度周期 (Cron)</th>
                                <th style="width:110px">任务状态</th>
                                <th style="text-align:right; padding-right:24px; width:80px">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tasks.length === 0 ? `<tr><td colspan="6">
                                <div class="empty-state-v2" style="padding:40px">
                                    <i data-lucide="calendar-days" style="width:32px; height:32px; opacity:0.2"></i>
                                    <div style="font-size:13px; color:var(--text-muted)">暂无活跃的定时任务</div>
                                </div>
                            </td></tr>` : ''}
                            ${tasks.map(t => {
                                const status = (t.status || 'active').toLowerCase();
                                const srvIds = t.target_servers ? t.target_servers.split(',') : [];
                                const srvCount = srvIds.length;
                                
                                return `
                                <tr style="border-bottom:1px solid var(--border-glass)">
                                    <td style="padding-left:24px; font-weight:600; color:var(--text-bright)">${t.name}</td>
                                    <td>
                                        <div style="display:flex; align-items:center; gap:6px">
                                            <i data-lucide="layers" style="width:12px; color:var(--accent-blue)"></i>
                                            <span style="font-size:12px">${srvCount} 个节点</span>
                                        </div>
                                    </td>
                                    <td>
                                        <code style="font-family:var(--font-mono); font-size:11px; color:var(--text-muted); background:rgba(0,0,0,0.2); padding:2px 6px; border-radius:4px" title="${t.command}">
                                            ${t.command.length < 25 ? t.command : (t.command.substring(0, 22) + '...')}
                                        </code>
                                    </td>
                                    <td><span style="font-family:var(--font-mono); color:var(--accent-blue); font-size:11px">${t.cron}</span></td>
                                    <td>
                                        <div style="display:flex; align-items:center; gap:10px">
                                            <label class="switch-container">
                                                <input type="checkbox" class="task-toggle" data-id="${t.id}" ${status==='active'?'checked':''}>
                                                <span class="switch-slider"></span>
                                            </label>
                                            <span style="font-size:10px; font-weight:800; color:${status==='active'?'var(--accent-green)':'var(--text-muted)'}">${status.toUpperCase()}</span>
                                        </div>
                                    </td>
                                    <td style="text-align:right; padding-right:24px">
                                        <button class="icon-button task-del-btn" data-id="${t.id}" style="color:#f43f5e; padding:6px"><i data-lucide="trash-2" style="width:14px"></i></button>
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
        safeCreateIcons();

        // 使用事件委托 (Event Delegation) 处理所有点击和变更事件，提高性能与可靠性
        container.onclick = async (e) => {
            // 1. 处理删除按钮
            const delBtn = e.target.closest('.task-del-btn');
            if (delBtn) {
                if (confirm("确定彻底删除此定时任务？")) {
                    const tid = delBtn.dataset.id;
                    const res = await fetch(`/api/automation/tasks/${tid}`, { method: 'DELETE' });
                    if (res.ok) renderScheduledTasks(container);
                }
                return;
            }

            // 2. 处理新增按钮
            const addBtn = e.target.closest('#add-task-btn');
            if (addBtn) {
                showTaskModal(servers, container);
                return;
            }
        };

        // 3. 处理状态切换 (Checkbox Change)
        container.onchange = async (e) => {
            const chk = e.target.closest('.task-toggle');
            if (chk) {
                const tid = chk.dataset.id;
                const res = await fetch(`/api/automation/tasks/${tid}/toggle`, { method: 'POST' });
                if (res.ok) {
                    // 不需要全量刷新 DOM，直接更新旁边的文字状态，提升交互感
                    const statusText = chk.parentElement.nextElementSibling;
                    const data = await res.json();
                    if (data.success) {
                        statusText.innerText = data.status.toUpperCase();
                        statusText.style.color = data.status === 'active' ? '#2ecc71' : '#5c6370';
                    }
                }
            }
        };
    }

    async function showTaskModal(servers, mainContainer) {
        const scpRes = await fetch('/api/scripts');
        const scripts = await scpRes.json();

        const modalHtml = `
            <div id="task-modal" class="modal-overlay" style="display:flex; backdrop-filter: blur(8px)">
                <div class="modal-content" style="width:640px; border-radius:20px; border:1px solid var(--border-glass)">
                    <div class="modal-header" style="padding:24px 30px; border-bottom:1px solid var(--border-glass)">
                        <h3 style="font-size:18px">配置自动化周期任务</h3>
                        <button id="close-task-modal" class="icon-button"><i data-lucide="x"></i></button>
                    </div>
                    <div class="modal-body" style="display:flex; flex-direction:column; gap:24px; padding:30px">
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px">
                            <div>
                                <label style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase">任务识别名称</label>
                                <input type="text" id="task-name" placeholder="例如：每日凌晨日志审计" style="width:100%; background:var(--bg-input); border:1px solid var(--border-color); color:var(--text-bright); padding:12px; border-radius:8px; outline:none">
                            </div>
                            <div>
                                <label style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase">调度频率 (CRON)</label>
                                <input type="text" id="task-cron" value="0 0 * * *" style="width:100%; background:var(--bg-input); border:1px solid var(--border-color); color:var(--accent-blue); padding:12px; border-radius:8px; outline:none; font-family:var(--font-mono)">
                            </div>
                        </div>
                        
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
                                <label style="font-size:11px; color:var(--text-muted); text-transform:uppercase">1. 选择执行节点范围</label>
                                <button class="icon-button" id="modal-select-all" style="font-size:10px; width:auto; padding:0 8px">全选所有</button>
                            </div>
                            <div id="modal-node-selector" style="max-height:160px; overflow-y:auto; padding-right:8px"></div>
                        </div>

                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
                                <label style="font-size:11px; color:var(--text-muted); text-transform:uppercase">2. 脚本内容 / 指令集</label>
                                <select id="task-script-picker" class="model-mini-select" style="width:180px">
                                    <option value="">-- 手动编写 --</option>
                                    ${scripts.map(s => `<option value="${encodeURIComponent(s.content)}" data-name="${s.name}">${s.name}</option>`).join('')}
                                </select>
                            </div>
                            <textarea id="task-cmd" placeholder="输入要按计划执行的 Shell 指令..." style="width:100%; height:140px; background:var(--bg-input); border:1px solid var(--border-color); color:var(--text-bright); padding:15px; border-radius:10px; outline:none; font-family:var(--font-mono); line-height:1.6"></textarea>
                        </div>
                        <div style="display:flex; gap:15px; margin-top:10px">
                            <button class="btn-cancel" id="cancel-task-modal" style="flex:1; padding:12px">取消并返回</button>
                            <button class="btn-confirm" id="save-task-btn" style="flex:2; padding:12px">
                                <i data-lucide="save" style="width:14px; margin-right:8px"></i> 保存并立即启用
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        renderNodeSelection(servers, 'modal-node-selector');
        safeCreateIcons();

        const selector = document.getElementById('modal-node-selector');
        document.getElementById('modal-select-all').onclick = () => {
            const cards = selector.querySelectorAll('.node-card');
            cards.forEach(c => {
                c.classList.add('selected');
                c.querySelector('.node-hidden-cb').checked = true;
            });
        };

        const picker = document.getElementById('task-script-picker');
        const cmdInput = document.getElementById('task-cmd');
        const nameInput = document.getElementById('task-name');
        
        picker.onchange = () => {
            if (picker.value) {
                cmdInput.value = decodeURIComponent(picker.value);
                // 自动填充任务名为脚本名 (如果没有填的话)
                if(!nameInput.value) nameInput.value = picker.options[picker.selectedIndex].dataset.name;
            }
        };

        document.getElementById('close-task-modal').onclick = () => document.getElementById('task-modal').remove();
        document.getElementById('cancel-task-modal').onclick = () => document.getElementById('task-modal').remove();
        document.getElementById('save-task-btn').onclick = async () => {
            const serverIds = Array.from(document.querySelectorAll('.node-hidden-cb:checked')).map(cb => cb.value);
            const data = {
                name: nameInput.value.trim(),
                cron: document.getElementById('task-cron').value.trim(),
                command: cmdInput.value.trim(),
                target_servers: serverIds.join(',')
            };
            
            if(!data.name || !data.command || serverIds.length === 0) return alert("请确保填写任务名称、选择至少一个服务器并输入命令");
            
            const res = await fetch('/api/automation/tasks', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            });
            if(res.ok) {
                document.getElementById('task-modal').remove();
                renderScheduledTasks(mainContainer);
            }
        };
    }

    async function renderSystemInspection(container) {
        container.innerHTML = `
            <div class="automation-view">
                <div class="auto-header" style="display:flex; justify-content:space-between; align-items:center">
                    <div>
                        <h2><i data-lucide="shield-check" style="margin-right:10px"></i> 系统巡检</h2>
                        <p>自动化健康检查，及时发现并修复系统潜在风险</p>
                    </div>
                    <button class="btn-confirm" id="run-inspect-btn"><i data-lucide="activity" style="width:16px; margin-right:8px"></i> 启动全量巡检</button>
                </div>
                <div id="inspect-results-area" style="margin-top:30px">
                    <div class="empty-state-v2">
                        <i data-lucide="layout" class="hero-icon"></i>
                        <h4>暂无巡检报告</h4>
                        <p>点击上方按钮立即启动并行巡检任务，系统将自动扫描所有节点的负载与磁盘状态。</p>
                    </div>
                </div>
            </div>`;
        safeCreateIcons();

        container.querySelector('#run-inspect-btn').onclick = async () => {
            const area = container.querySelector('#inspect-results-area');
            area.innerHTML = `<div style="padding:100px 40px; text-align:center; color:var(--text-muted)">
                <i data-lucide="loader-2" class="spin" style="width:32px; height:32px; margin-bottom:20px; opacity:0.3"></i>
                <div style="font-size:14px">正在建立并行 SSH 通道巡检中，请稍候...</div>
            </div>`;
            safeCreateIcons();

            const res = await fetch('/api/automation/inspect', { method: 'POST' });
            const { data } = await res.json();

            // 统计数据程序化生成 (简单环形图实现)
            const passed = data.filter(x => x.status === 'pass').length;
            const warned = data.filter(x => x.status === 'warning' || x.status === 'warn').length;
            const failed = data.filter(x => x.status === 'fail').length;
            const total = data.length;

            area.innerHTML = `
                <div class="inspect-summary-dashboard">
                    <div class="inspect-chart-container">
                        <svg viewBox="0 0 36 36" style="width:100%; height:100%; transform: rotate(-90deg)">
                            <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="3"></circle>
                            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#2ecc71" stroke-width="3" 
                                stroke-dasharray="${(passed/total)*100} 100" stroke-dashoffset="0"></circle>
                            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f39c12" stroke-width="3" 
                                stroke-dasharray="${(warned/total)*100} 100" stroke-dashoffset="-${(passed/total)*100}"></circle>
                            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f43f5e" stroke-width="3" 
                                stroke-dasharray="${(failed/total)*100} 100" stroke-dashoffset="-${((passed+warned)/total)*100}"></circle>
                        </svg>
                        <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center">
                            <span style="font-size:24px; font-weight:700; color:var(--text-bright)">${total}</span>
                            <span style="font-size:10px; color:var(--text-muted); text-transform:uppercase">总节点</span>
                        </div>
                    </div>
                    <div class="inspect-stats">
                        <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:10px; text-transform:uppercase">巡检结果统计</div>
                        <div class="inspect-stat-item">
                            <div class="inspect-stat-dot" style="background:#2ecc71"></div>
                            <span style="font-size:13px; color:var(--text-bright)">${passed} 正常节点</span>
                        </div>
                        <div class="inspect-stat-item">
                            <div class="inspect-stat-dot" style="background:#f39c12"></div>
                            <span style="font-size:13px; color:var(--text-bright)">${warned} 存在风险</span>
                        </div>
                        <div class="inspect-stat-item">
                            <div class="inspect-stat-dot" style="background:#f43f5e"></div>
                            <span style="font-size:13px; color:var(--text-bright)">${failed} 无法连接</span>
                        </div>
                    </div>
                </div>
                
                <div class="inspect-list">
                    ${data.map(item => `
                        <div class="inspect-row" style="display:flex; justify-content:space-between; align-items:center; padding:18px 24px; background:var(--bg-panel); border-radius:12px; margin-bottom:12px; border:1px solid var(--border-glass); transition:0.2s">
                            <div style="display:flex; align-items:center">
                                <i data-lucide="${item.status==='pass'?'check-circle':(item.status==='fail'?'x-circle':'alert-triangle')}" 
                                   style="width:20px; height:20px; color:${item.status==='pass'?'#2ecc71':(item.status==='fail'?'#f43f5e':'#f39c12')}; margin-right:18px"></i>
                                <div>
                                    <div style="font-weight:600; font-size:14px; color:var(--text-bright)">${item.item}</div>
                                    <div style="font-size:12px; color:var(--text-muted); margin-top:4px">${item.desc}</div>
                                </div>
                            </div>
                            <div class="badge-premium ${item.status==='pass'?'pass':(item.status==='fail'?'fail':'warn')}">
                                ${item.status==='pass'?'NORMAL':(item.status==='fail'?'CRITICAL':'WARNING')}
                            </div>
                        </div>
                    `).join('')}
                </div>`;
            safeCreateIcons();
        };
    }

    // --- 最终初始化 ---
    // 强制初始化 CSS 变量以防止布局跳动
    const app = document.getElementById('nexus-app');
    if (app) {
        app.style.setProperty('--explorer-width', '260px');
        app.style.setProperty('--ai-panel-width', '330px');
    }

    loadServers();
    initResizers();
    safeCreateIcons();
});
