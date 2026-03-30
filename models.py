from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Server(db.Model):
    __tablename__ = 'servers'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    ip = db.Column(db.String(50), nullable=False)
    port = db.Column(db.Integer, default=22)
    username = db.Column(db.String(50), nullable=False)
    password = db.Column(db.String(100))
    group = db.Column(db.String(100), default='默认分组')
    status = db.Column(db.String(20), default='unknown')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "ip": self.ip,
            "port": self.port,
            "username": self.username,
            "group": self.group,
            "status": self.status
        }

class AuditLog(db.Model):
    __tablename__ = 'audit_logs'
    id = db.Column(db.Integer, primary_key=True)
    server_id = db.Column(db.Integer, db.ForeignKey('servers.id'))
    command = db.Column(db.Text, nullable=False)
    output = db.Column(db.Text)
    operator = db.Column(db.String(50), default='admin')
    executed_at = db.Column(db.DateTime, default=datetime.utcnow)

class Script(db.Model):
    __tablename__ = 'scripts'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    content = db.Column(db.Text, nullable=False)
    type = db.Column(db.String(20), default='shell')
    description = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class FileTask(db.Model):
    __tablename__ = 'file_tasks'
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    local_path = db.Column(db.String(512))
    remote_path = db.Column(db.String(512))
    server_id = db.Column(db.Integer, db.ForeignKey('servers.id'))
    status = db.Column(db.String(20), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class ScheduledTask(db.Model):
    __tablename__ = 'scheduled_tasks'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    cron = db.Column(db.String(100), nullable=False) # * * * * *
    command = db.Column(db.Text, nullable=False)
    target_servers = db.Column(db.Text) # 存储为 JSON 字符串
    status = db.Column(db.String(20), default='active') # active, paused
    last_run = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'cron': self.cron,
            'command': self.command,
            'target_servers': self.target_servers,
            'status': self.status,
            'last_run': self.last_run.isoformat() if self.last_run else None,
            'created_at': self.created_at.isoformat()
        }

class Document(db.Model):
    __tablename__ = 'documents'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(50), default='General')
    content = db.Column(db.Text)
    last_modified = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class AIModel(db.Model):
    __tablename__ = 'ai_models'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    provider = db.Column(db.String(50), default='openai')
    base_url = db.Column(db.String(255))
    api_key = db.Column(db.String(255))
    model_name = db.Column(db.String(100))
    is_active = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "provider": self.provider,
            "base_url": self.base_url,
            "api_key": self.api_key,
            "model_name": self.model_name,
            "is_active": self.is_active
        }
