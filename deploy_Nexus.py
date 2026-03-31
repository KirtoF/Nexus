import os
import shutil
import subprocess
import sys

# 1. 基础配置
project_dir = os.path.abspath(".")
dist_dir = os.path.join(project_dir, "dist", "Nexus")
internal_dir = os.path.join(dist_dir, "_internal")

def build():
    # 1. 强制杀死进程以免锁定文件 (必须在删除目录前执行)
    subprocess.run("taskkill /F /IM Nexus-AIOps.exe /T", shell=True, stderr=subprocess.DEVNULL)
    
    print(">>> 步骤 1: 清理旧构建...")
    if os.path.exists("build"): shutil.rmtree("build")
    if os.path.exists("dist"): shutil.rmtree("dist")
    
    # 获取当前 Python 解释器版本以便确认
    print(f">>> 当前构建使用的是: {sys.executable}")
    
    print(">>> 步骤 2: 执行全量 PyInstaller 编译 (保持 DLL 完整性)...")
    result = subprocess.run(f'"{sys.executable}" -m PyInstaller nexus.spec --noconfirm', shell=True)
    
    if result.returncode != 0:
        print("!!! 编译失败")
        return False
    
    return True

if __name__ == "__main__":
    if build():
        print("\n>>> [部署完成] 所有 DLL 已原样保留。请启动 dist/Nexus/Nexus-AIOps.exe")
