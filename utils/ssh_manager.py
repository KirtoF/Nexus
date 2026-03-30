import paramiko
import socket

class SSHManager:
    @staticmethod
    def execute_command(ip, port, username, password, command):
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(ip, port=port, username=username, password=password, timeout=10)
            stdin, stdout, stderr = client.exec_command(command)
            output = stdout.read().decode('utf-8')
            error = stderr.read().decode('utf-8')
            return {"success": True, "output": output, "error": error}
        except Exception as e:
            return {"success": False, "error": str(e)}
        finally:
            client.close()

    @staticmethod
    def test_connection(ip, port, username, password):
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(ip, port=port, username=username, password=password, timeout=5)
            return True
        except:
            return False
        finally:
            client.close()
